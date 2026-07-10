export function splitTopLevel(s: string): string[] {
  const results: string[] = [];
  let currentToken = "";
  let inQuotes = false;
  let squareDepth = 0;
  let parenDepth = 0;

  let i = 0;
  while (i < s.length) {
    const char = s[i]!;
    if (inQuotes) {
      if (char === "\\") {
        if (i + 1 < s.length) {
          const nextChar = s[i + 1]!;
          if (nextChar === '"') {
            currentToken += '"';
          } else if (nextChar === "\\") {
            currentToken += "\\";
          } else {
            currentToken += "\\" + nextChar;
          }
          i += 2;
        } else {
          currentToken += "\\";
          i++;
        }
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        currentToken += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === "[") {
        squareDepth++;
        currentToken += char;
        i++;
      } else if (char === "]") {
        squareDepth--;
        currentToken += char;
        i++;
      } else if (char === "(") {
        parenDepth++;
        currentToken += char;
        i++;
      } else if (char === ")") {
        parenDepth--;
        currentToken += char;
        i++;
      } else if (char === ",") {
        if (squareDepth === 0 && parenDepth === 0) {
          results.push(currentToken);
          currentToken = "";
        } else {
          currentToken += char;
        }
        i++;
      } else {
        currentToken += char;
        i++;
      }
    }
  }
  results.push(currentToken);
  return results;
}

export function splitLine(line: string): {
  datePart: string;
  eventName: string;
  params: string[];
} | null {
  const doubleSpaceIndex = line.indexOf("  ");
  if (doubleSpaceIndex === -1) {
    return null;
  }
  const datePart = line.substring(0, doubleSpaceIndex);
  if (!datePart) {
    return null;
  }
  const rest = line.substring(doubleSpaceIndex + 2);
  const commaIndex = rest.indexOf(",");
  if (commaIndex === -1) {
    return null;
  }
  const eventName = rest.substring(0, commaIndex);
  if (!eventName) {
    return null;
  }
  const paramsPart = rest.substring(commaIndex + 1);
  const params = splitTopLevel(paramsPart);
  return {
    datePart,
    eventName,
    params,
  };
}
