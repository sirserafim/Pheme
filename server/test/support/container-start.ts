export type ContainerStartStage = 'docker-access' | 'image-pull' | 'startup';

export function classifyContainerStart(error: unknown): ContainerStartStage {
  const text = errorChain(error);
  if (
    /ECONNREFUSED|ENOENT|EACCES|EPERM|npipe|named pipe|pipe\/docker|docker\.sock|cannot connect to the docker|connect to docker|no docker|daemon is not running|the docker desktop|compose.*not found/i.test(
      text,
    )
  ) {
    return 'docker-access';
  }
  if (
    /pull|manifest unknown|not found: manifest|unauthorized|toomanyrequests|denied.*pull|image.*not found/i.test(
      text,
    )
  ) {
    return 'image-pull';
  }
  return 'startup';
}

export function describeContainerStartFailure(error: unknown): string {
  const stage = classifyContainerStart(error);
  const detail = firstLine(errorChain(error));
  if (stage === 'docker-access') {
    return `Docker was not reachable (${detail}). A running Docker Desktop window is not enough; the engine must accept API calls.`;
  }
  if (stage === 'image-pull') {
    return `The PostgreSQL image could not be pulled (${detail}).`;
  }
  return `The PostgreSQL container did not become ready (${detail}). The init script runs before the server accepts connections.`;
}

function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? text;
}
