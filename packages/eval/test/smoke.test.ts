import * as pkg from '../src/index';

describe('smoke test', () => {
  it('asserts typeof pkg === "object"', () => {
    expect(typeof pkg).toBe('object');
  });
});
