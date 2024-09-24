import * as crypto from 'crypto';
import { Duration, Names, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

//export interface TargetResourceProperty {
//  readonly tagKey: string;
//  readonly tagValues: string[];
//}

export interface RDSDatabaseAutoRunningStopStackProps extends StackProps {
  // readonly targetResource: TargetResourceProperty;
  readonly enableRule?: boolean;
}

export class RDSDatabaseAutoRunningStopStack extends Stack {
  constructor(scope: Construct, id: string, props?: RDSDatabaseAutoRunningStopStackProps) {
    super(scope, id, props);

    const account = Stack.of(this).account;
    //const region = Stack.of(this).region;

    // 👇Create random key
    const key = crypto.createHash('shake256', { outputLength: 4 })
      .update(`${Names.uniqueId(scope)}.${Names.uniqueId(this)}`)
      .digest('hex');

    const succeed = new sfn.Succeed(this, 'Succeed');

    // Status definition
    const statusesDefinition: sfn.Pass = new sfn.Pass(this, 'StatusesDefinition', {
      result: sfn.Result.fromObject([
        { name: 'AVAILABLE', emoji: '🤩', state: 'available' },
        { name: 'AUTOSTOPPED', emoji: '😴', state: 'stopped' },
      ]),
      resultPath: '$.definition.statuses',
    });

    const describeDBInstancesTask = new tasks.CallAwsService(this, 'DescribeDBInstances', {
      iamResources: [`arn:aws:rds:*:${account}:db:*`],
      service: 'rds',
      action: 'describeDBInstances',
      parameters: {
        DbInstanceIdentifier: sfn.JsonPath.stringAt('$.event.detail.SourceIdentifier'),
      },
      resultPath: '$.result.describe',
      resultSelector: {
        status: sfn.JsonPath.stringAt('$.DbInstances[0].DbInstanceStatus'),
        identifier: sfn.JsonPath.stringAt('$.DbInstances[0].DbInstanceIdentifier'),
        tags: sfn.JsonPath.stringAt('$.DbInstances[0].TagList'),
      },
    });

    const stopDBInstanceTask = new tasks.CallAwsService(this, 'StopDBInstance', {
      iamResources: [`arn:aws:rds:*:${account}:db:*`],
      service: 'rds',
      action: 'stopDBInstance',
      parameters: {
        DbInstanceIdentifier: sfn.JsonPath.stringAt('$.event.detail.SourceIdentifier'),
      },
      resultPath: '$.result.stop',
    });

    const describeDBClustersTask = new tasks.CallAwsService(this, 'DescribeDBClusters', {
      iamResources: [`arn:aws:rds:*:${account}:cluster:*`],
      service: 'rds',
      action: 'describeDBClusters',
      parameters: {
        DbClusterIdentifier: sfn.JsonPath.stringAt('$.event.detail.SourceIdentifier'),
      },
      resultPath: '$.result.describe',
      resultSelector: {
        status: sfn.JsonPath.stringAt('$.DbClusters[0].Status'),
        identifier: sfn.JsonPath.stringAt('$.DbClusters[0].DbClusterIdentifier'),
        tags: sfn.JsonPath.stringAt('$.DbClusters[0].TagList'),
      },
    });

    const stopDBClusterTask = new tasks.CallAwsService(this, 'StopDBCluster', {
      iamResources: [`arn:aws:rds:*:${account}:cluster:*`],
      service: 'rds',
      action: 'stopDBCluster',
      parameters: {
        DbClusterIdentifier: sfn.JsonPath.stringAt('$.event.detail.SourceIdentifier'),
      },
      resultPath: '$.result.stop',
    });

    const describeTypeChoice = new sfn.Choice(this, 'DescribeTypeChoice')
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Instance Event'),
          sfn.Condition.stringEquals('$.event.detail.SourceType', 'DB_INSTANCE'),
          sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0154'),
        ),
        describeDBInstancesTask,
      )
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Cluster Event'),
          sfn.Condition.stringEquals('$.event.detail.SourceType', 'CLUSTER'),
          sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0153'),
        ),
        describeDBClustersTask,
      )
      .otherwise(new sfn.Fail(this, 'UnknownType'));

    statusesDefinition.next(describeTypeChoice);

    const statusChangeWait = new sfn.Wait(this, 'StatusChangeWait', {
      time: sfn.WaitTime.duration(Duration.minutes(5)),
    });

    statusChangeWait.next(describeTypeChoice);

    stopDBInstanceTask.next(statusChangeWait);

    stopDBClusterTask.next(statusChangeWait);

    // 👇 Status Choice
    const statusChoice = new sfn.Choice(this, 'StatusChoice')
      // db instance stop on status.available
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Instance Event'),
          sfn.Condition.stringEquals('$.event.detail.SourceType', 'DB_INSTANCE'),
          sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0154'),
          sfn.Condition.stringEquals('$.result.describe.status', 'available'),
        ),
        stopDBInstanceTask,
      )
      // db cluster stop on status.available
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Cluster Event'),
          sfn.Condition.stringEquals('$.event.detail.SourceType', 'CLUSTER'),
          sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0153'),
          sfn.Condition.stringEquals('$.result.describe.status', 'available'),
        ),
        stopDBClusterTask,
      )
      // status change succeed, // todo: generate topic
      .when(
        sfn.Condition.and(
          sfn.Condition.or(
            sfn.Condition.and(
              sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Instance Event'),
              sfn.Condition.stringEquals('$.event.detail.SourceType', 'DB_INSTANCE'),
              sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0154'),
            ),
            sfn.Condition.and(
              sfn.Condition.stringEquals('$.event.detail-type', 'RDS DB Cluster Event'),
              sfn.Condition.stringEquals('$.event.detail.SourceType', 'CLUSTER'),
              sfn.Condition.stringEquals('$.event.detail.EventID', 'RDS-EVENT-0153'),
            ),
          ),
          sfn.Condition.stringEquals('$.result.describe.status', 'stopped'),
        ),
        succeed,
      )
      .when(
        sfn.Condition.or(
          sfn.Condition.stringEquals('$.result.describe.status', 'starting'),
          sfn.Condition.stringEquals('$.result.describe.status', 'configuring-enhanced-monitoring'),
          sfn.Condition.stringEquals('$.result.describe.status', 'backing-up'),
          sfn.Condition.stringEquals('$.result.describe.status', 'modifying'),
          sfn.Condition.stringEquals('$.result.describe.status', 'stopping'),
        ),
        statusChangeWait,
      )
      .otherwise(new sfn.Fail(this, 'StatusFail', {
        cause: 'db instance or cluster status fail.',
      }));

    describeDBInstancesTask.next(statusChoice);
    describeDBClustersTask.next(statusChoice);

    // 👇 StepFunctions
    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: `rds-db-auto-running-stop-${key}-state-machine`,
      definition: statusesDefinition,
    });
    const role = stateMachine.node.findChild('Role') as iam.Role;
    const cfnRole = role.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('RoleName', `rds-db-auto-running-stop-state-machine-${key}-role`);
    cfnRole.addPropertyOverride('Description', 'rds database auto running stop state machine role.');
    const policy = role.node.findChild('DefaultPolicy') as iam.Policy;
    const cfnPolicy = policy.node.defaultChild as iam.CfnPolicy;
    cfnPolicy.addPropertyOverride('PolicyName', 'default-policy');

    const execRole = new iam.Role(this, 'EventExecRole', {
      roleName: `rds-db-auto-running-catch-event-${key}-role`,
      description: 'db auto start catch with start state machine event role',
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      inlinePolicies: {
        'state-machine-exec': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:StartExecution',
              ],
              resources: [
                stateMachine.stateMachineArn,
              ],
            }),
          ],
        }),
      },
    });

    const enableRule: boolean = (() => {
      return props?.enableRule === undefined || props.enableRule;
    })();

    // 👇 EventBridge by RDS DB Instance Auto Start Event
    new events.Rule(this, 'DBInstanceEvent', {
      ruleName: `rds-db-instance-running-event-catch-${key}-rule`,
      description: 'rds db instance running event catch rule.',
      enabled: enableRule,
      eventPattern: {
        source: ['aws.rds'],
        detailType: ['RDS DB Instance Event'],
        detail: {
          EventID: ['RDS-EVENT-0154'],
        },
      },
      targets: [
        new targets.SfnStateMachine(stateMachine, {
          role: execRole,
          input: events.RuleTargetInput.fromObject({
            event: events.EventField.fromPath('$'),
            // params: {
            //   tagKey: props.targetResource.tagKey,
            //   tagValues: props.targetResource.tagValues,
            // },
          }),
        }),
      ],
    });

    // 👇 EventBridge by RDS DB Instance Auto Start Event
    new events.Rule(this, 'DBClusterEvent', {
      ruleName: `rds-db-cluster-running-event-catch-${key}-rule`,
      description: 'db cluster running event catch rule',
      enabled: enableRule,
      eventPattern: {
        source: ['aws.rds'],
        detailType: ['RDS DB Cluster Event'],
        detail: {
          EventID: ['RDS-EVENT-0153'],
        },
      },
      targets: [
        new targets.SfnStateMachine(stateMachine, {
          role: execRole,
          input: events.RuleTargetInput.fromObject({
            event: events.EventField.fromPath('$'),
            // params: {
            //   tagKey: props.targetResource.tagKey,
            //   tagValues: props.targetResource.tagValues,
            // },
          }),
        }),
      ],
    });
  }
}