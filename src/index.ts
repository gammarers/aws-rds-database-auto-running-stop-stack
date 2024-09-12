import * as crypto from 'crypto';
import { Duration, Names, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface TargetResourceProperty {
  readonly tagKey: string;
  readonly tagValues: string[];
}

export interface RDSDatabaseAutoRunningStopStackProps extends StackProps {
  readonly targetResource: TargetResourceProperty;
  readonly enableRule?: boolean;
}

export class RDSDatabaseAutoRunningStopStack extends Stack {
  constructor(scope: Construct, id: string, props?: RDSDatabaseAutoRunningStopStackProps) {
    super(scope, id, props);

    const account = Stack.of(this).account;
    //const region = Stack.of(this).region;

    // 👇Create random key
    const key = crypto.createHash('shake256', { outputLength: 4 })
      .update(`${Names.uniqueId(scope)}-${Names.uniqueId(this)}`)
      .digest('hex');

    const succeed = new sfn.Succeed(this, 'Succeed');

    const describeDBInstancesTask = new tasks.CallAwsService(this, 'DescribeDBInstances', {
      iamResources: [`arn:aws:rds:*:${account}:db:*`],
      service: 'rds',
      action: 'describeDBInstances',
      parameters: {},
      resultPath: '$.Result',
      outputPath: '$.Result.DbInstances[?(@.DbInstanceIdentifier == $.detail.SourceIdentifier)]',
    });

    const stopDBInstanceTask = new tasks.CallAwsService(this, 'StopDBInstance', {
      iamResources: [`arn:aws:rds:*:${account}:db:*`],
      service: 'rds',
      action: 'stopDBInstance',
      parameters: {
        'DbInstanceIdentifier.$': '$[0].DbInstanceIdentifier',
      },
    }).next(succeed);

    const describeDBClustersTask = new tasks.CallAwsService(this, 'DescribeDBClusters', {
      iamResources: [`arn:aws:rds:*:${account}:cluster:*`],
      service: 'rds',
      action: 'describeDBClusters',
      parameters: {},
      resultPath: '$.Result',
      outputPath: '$.Result.DbClusters[?(@.DbClusterIdentifier == $.detail.SourceIdentifier)]',
    });

    const stopDBClusterTask = new tasks.CallAwsService(this, 'StopDBCluster', {
      iamResources: [`arn:aws:rds:*:${account}:cluster:*`],
      service: 'rds',
      action: 'stopDBCluster',
      parameters: {
        'DbClusterIdentifier.$': '$[0].DbClusterIdentifier',
      },
    }).next(succeed);

    const definition = new sfn.Choice(this, 'TypeCheck')
      .when(
        sfn.Condition.stringEquals('$.detail-type', 'RDS DB Instance Event'),
        describeDBInstancesTask.next(
          new sfn.Choice(this, 'DBInstanceStatCheck')
            .when(
              sfn.Condition.stringEquals('$[0].DbInstanceStatus', 'available'),
              stopDBInstanceTask,
            )
            .otherwise(
              new sfn.Wait(this, 'InstanceBootPending', {
                time: sfn.WaitTime.duration(Duration.seconds(600)),
              }).next(
                new sfn.Pass(this, 'DBInstanceIdentifierPass', {
                  parameters: {
                    detail: {
                      'SourceIdentifier.$': '$[0].DbInstanceIdentifier',
                    },
                  },
                }).next(describeDBInstancesTask),
              ),
            ),
        ),
      )
      .when(
        sfn.Condition.stringEquals('$.detail-type', 'RDS DB Cluster Event'),
        describeDBClustersTask.next(
          new sfn.Choice(this, 'DBClusterStatCheck')
            .when(
              sfn.Condition.stringEquals('$[0].Status', 'available'),
              stopDBClusterTask,
            )
            .otherwise(
              new sfn.Wait(this, 'ClusterBootPending', {
                time: sfn.WaitTime.duration(Duration.seconds(600)),
              }).next(
                new sfn.Pass(this, 'DBClusterIdentifierPass', {
                  parameters: {
                    detail: {
                      'SourceIdentifier.$': '$[0].DbClusterIdentifier',
                    },
                  },
                }).next(describeDBClustersTask),
              ),
            ),
        ),
      );

    // 👇 StepFunctions
    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: `db-auto-start-stop-${key}-state-machine`,
      //role: machineRole,
      definition,
    });
    const role = stateMachine.node.findChild('Role') as iam.Role;
    const cfnRole = role.node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('RoleName', `rds-database-auto-running-stop-state-machine-${key}-role`);
    cfnRole.addPropertyOverride('Description', 'rds database auto running stop state machine role.');
    const policy = role.node.findChild('DefaultPolicy') as iam.Policy;
    const cfnPolicy = policy.node.defaultChild as iam.CfnPolicy;
    cfnPolicy.addPropertyOverride('PolicyName', `rds-database-auto-running-stop-state-machine-default-${key}-policy`);

    const execRole = new iam.Role(this, 'EventExecRole', {
      roleName: `db-auto-start-catch-event-${key}-role`,
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
      ruleName: `db-instance-start-event-catch-${key}-rule`,
      description: 'db instance start event catch rule.',
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
        }),
      ],
    });

    // 👇 EventBridge by RDS DB Instance Auto Start Event
    new events.Rule(this, 'DBClusterEvent', {
      ruleName: `db-cluster-start-event-catch-${key}-rule`,
      description: 'db cluster start event catch rule',
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
        }),
      ],
    });
  }
}