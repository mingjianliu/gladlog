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

describe('binarySearchClosest — ties (GH #100, user ruling 2026-09-23)', () => {
  type S = { ts: number; hp: number };
  const keyFn = (s: S) => s.ts;

  it('same timestamp: the LAST sample in log order wins — the state after that instant', () => {
    // The real case: a Holy Priest at 26.87 s — DoT tick line (88 %) then a
    // Prayer of Mending line (90 %), same 0.1 ms stamp.
    const arr: S[] = [
      { ts: 25630, hp: 1 },
      { ts: 26870, hp: 88 },
      { ts: 26870, hp: 90 },
      { ts: 27250, hp: 2 },
    ];
    expect(binarySearchClosest(arr, 27000, keyFn)?.hp).toBe(90);
    expect(binarySearchClosest(arr, 26870, keyFn)?.hp).toBe(90);
  });

  it('the choice does not move when unrelated samples are added anywhere', () => {
    const core: S[] = [
      { ts: 26870, hp: 88 },
      { ts: 26870, hp: 91 },
      { ts: 26870, hp: 90 },
    ];
    for (let pre = 0; pre < 40; pre++) {
      for (let post = 0; post < 5; post++) {
        const arr: S[] = [
          ...Array.from({ length: pre }, (_, i) => ({ ts: 100 + i, hp: -1 })),
          ...core,
          ...Array.from({ length: post }, (_, i) => ({ ts: 40000 + i, hp: -2 })),
        ];
        expect(binarySearchClosest(arr, 27000, keyFn)?.hp).toBe(90);
      }
    }
  });

  it('equal distance on both sides: the earlier timestamp wins, last of its instant', () => {
    const arr: S[] = [
      { ts: 900, hp: 10 },
      { ts: 900, hp: 11 },
      { ts: 1100, hp: 20 },
    ];
    expect(binarySearchClosest(arr, 1000, keyFn)?.hp).toBe(11);
  });

  it('a later sample of the same instant wins over an earlier one on the far side', () => {
    const arr: S[] = [
      { ts: 900, hp: 10 },
      { ts: 1050, hp: 30 },
      { ts: 1050, hp: 31 },
    ];
    expect(binarySearchClosest(arr, 1000, keyFn)?.hp).toBe(31);
  });
});
