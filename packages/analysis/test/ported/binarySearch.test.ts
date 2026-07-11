import { binarySearchClosest } from '../../src/utils/binarySearch';

describe('binarySearchClosest', () => {
  const data = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }, { ts: 5000 }];
  const keyFn = (item: { ts: number }) => item.ts;

  it('should return null for an empty array', () => {
    expect(binarySearchClosest([], 2500, keyFn)).toBeNull();
  });

  it('should find the exact match', () => {
    expect(binarySearchClosest(data, 3000, keyFn)).toEqual({ ts: 3000 });
  });

  it('should find the closest item when target is between two items (closer to lower)', () => {
    expect(binarySearchClosest(data, 2400, keyFn)).toEqual({ ts: 2000 });
  });

  it('should find the closest item when target is between two items (closer to higher)', () => {
    expect(binarySearchClosest(data, 2600, keyFn)).toEqual({ ts: 3000 });
  });

  it('should find the closest item at the beginning of the array', () => {
    expect(binarySearchClosest(data, 500, keyFn)).toEqual({ ts: 1000 });
  });

  it('should find the closest item at the end of the array', () => {
    expect(binarySearchClosest(data, 5500, keyFn)).toEqual({ ts: 5000 });
  });

  it('should handle target timestamp smaller than all items', () => {
    expect(binarySearchClosest(data, 100, keyFn)).toEqual({ ts: 1000 });
  });

  it('should handle target timestamp larger than all items', () => {
    expect(binarySearchClosest(data, 6000, keyFn)).toEqual({ ts: 5000 });
  });

  it('should handle single element array', () => {
    expect(binarySearchClosest([{ ts: 1000 }], 900, keyFn)).toEqual({ ts: 1000 });
    expect(binarySearchClosest([{ ts: 1000 }], 1100, keyFn)).toEqual({ ts: 1000 });
  });
});
