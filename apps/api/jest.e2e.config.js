/** End-to-end tests: real HTTP pipeline against a dedicated PostgreSQL database (see test/setup-env.js). */
module.exports = {
  rootDir: 'test',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.e2e\\.ts$',
  setupFiles: ['<rootDir>/setup-env.js'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
  testTimeout: 60000,
};
