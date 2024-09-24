import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { RDSDatabaseAutoRunningStopStack } from '../src';

describe('RDSDatabaseAutoRunningStopStack Disabble Testing', () => {

  const app = new App();

  const stack = new RDSDatabaseAutoRunningStopStack(app, 'RDSDatabaseAutoRunningStopStack', {
    enableRule: false,
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });

  const template = Template.fromStack(stack);

  it('Should match snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

});
