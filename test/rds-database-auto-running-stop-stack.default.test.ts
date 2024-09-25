import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RDSDatabaseAutoRunningStopStack } from '../src';

describe('RDSDatabaseAutoRunningStopStack Default Testing', () => {

  const app = new App();

  const stack = new RDSDatabaseAutoRunningStopStack(app, 'RDSDatabaseAutoRunningStopStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
    targetResource: {
      tagKey: 'AutoRunningStop',
      tagValues: ['YES'],
    },
  });

  const template = Template.fromStack(stack);

  it('Should match state machine', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', Match.objectEquals({
      StateMachineName: Match.anyValue(),
      DefinitionString: Match.anyValue(),
      RoleArn: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('StateMachineRole'),
          'Arn',
        ],
      },
    }));
  });

  it('Should match iam role count', () => {
    template.resourceCountIs('AWS::IAM::Role', 2);
  });

  it('Should match event rule count', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('Should match snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

});
