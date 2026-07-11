import * as pkg from '../src/index';

describe('smoke test', () => {
  it('should import successfully and be defined', () => {
    expect(pkg).toBeDefined();
  });
});
