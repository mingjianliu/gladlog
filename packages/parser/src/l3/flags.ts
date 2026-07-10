export function decodeFlags(rawFlags: number): {
  affiliation: 'Mine' | 'Party' | 'Raid' | 'Outsider' | 'Unknown';
  reaction: 'Friendly' | 'Neutral' | 'Hostile' | 'Unknown';
  kind: 'Player' | 'NPC' | 'Pet' | 'Guardian' | 'Object' | 'Unknown';
} {
  const flags = rawFlags & 0xFFFF;

  const affMask = flags & 0xF;
  let affiliation: 'Mine' | 'Party' | 'Raid' | 'Outsider' | 'Unknown' = 'Unknown';
  if (affMask & 0x1) affiliation = 'Mine';
  else if (affMask & 0x2) affiliation = 'Party';
  else if (affMask & 0x4) affiliation = 'Raid';
  else if (affMask & 0x8) affiliation = 'Outsider';

  const reactMask = flags & 0xF0;
  let reaction: 'Friendly' | 'Neutral' | 'Hostile' | 'Unknown' = 'Unknown';
  if (reactMask & 0x10) reaction = 'Friendly';
  else if (reactMask & 0x20) reaction = 'Neutral';
  else if (reactMask & 0x40) reaction = 'Hostile';

  const kindMask = flags & 0xFC00;
  let kind: 'Player' | 'NPC' | 'Pet' | 'Guardian' | 'Object' | 'Unknown' = 'Unknown';
  if (kindMask & 0x2000) kind = 'Guardian';
  else if (kindMask & 0x1000) kind = 'Pet';
  else if (kindMask & 0x400) kind = 'Player';
  else if (kindMask & 0x4000) kind = 'Object';
  else if (kindMask & 0x800) kind = 'NPC';

  return { affiliation, reaction, kind };
}
