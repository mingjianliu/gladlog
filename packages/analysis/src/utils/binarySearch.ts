export function binarySearchClosest<T>(arr: T[], targetTimestamp: number, keyFn: (item: T) => number): T | null {
  if (arr.length === 0) {
    return null;
  }

  let low = 0;
  let high = arr.length - 1;
  let closest = arr[0];
  let minDiff = Math.abs(keyFn(arr[0]) - targetTimestamp);

  while (low <= high) {
    const mid = Math.floor(low + (high - low) / 2);
    const midItem = arr[mid];
    const midTimestamp = keyFn(midItem);
    const currentDiff = Math.abs(midTimestamp - targetTimestamp);

    if (currentDiff < minDiff) {
      minDiff = currentDiff;
      closest = midItem;
    } else if (currentDiff === minDiff) {
      if (midTimestamp < keyFn(closest)) {
        closest = midItem;
      }
    }

    if (midTimestamp === targetTimestamp) {
      return midItem;
    } else if (midTimestamp < targetTimestamp) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return closest;
}
