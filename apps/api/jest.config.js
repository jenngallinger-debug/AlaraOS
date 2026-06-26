/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@alara-os/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@alara-os/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
  },
};
