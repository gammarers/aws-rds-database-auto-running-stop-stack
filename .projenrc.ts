import { awscdk, javascript } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'yicr',
  authorAddress: 'yicr@users.noreply.github.com',
  cdkVersion: '2.120.0',
  constructsVersion: '10.0.5',
  defaultReleaseBranch: 'main',
  typescriptVersion: '5.4.x',
  jsiiVersion: '5.4.x',
  name: '@gammarers/aws-rds-database-auto-running-stop-stack',
  description: 'This construct is aws rds database or cluster auto running to stop.',
  keywords: ['aws', 'cdk', 'aws-cdk', 'rds', 'run', 'auto', 'stop'],
  projenrcTs: true,
  repositoryUrl: 'https://github.com/gammarers/aws-rds-database-auto-running-stop-stack.git',
  authorOrganization: true,
  releaseToNpm: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  majorVersion: 1,
  minNodeVersion: '18.0.0',
  workflowNodeVersion: '22.4.x',
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      schedule: javascript.UpgradeDependenciesSchedule.expressions(['0 19 * * 3']),
    },
  },
  autoApproveOptions: {
    secret: 'GITHUB_TOKEN',
    allowedUsernames: ['yicr'],
  },
});
project.synth();