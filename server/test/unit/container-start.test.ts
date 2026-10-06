import { describe, expect, it } from 'vitest';
import { classifyContainerStart, describeContainerStartFailure } from '../support/container-start.ts';
import { countOccurrences, withoutSecrets } from '../support/secrets.ts';

describe('classifyContainerStart', () => {
  it('treats a refused Docker socket as a Docker-access problem', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED //./pipe/docker_engine'), {
      code: 'ECONNREFUSED',
    });
    expect(classifyContainerStart(error)).toBe('docker-access');
    expect(describeContainerStartFailure(error)).toContain('Docker Desktop window is not enough');
  });

  it('treats a pull failure as an image-pull problem', () => {
    expect(classifyContainerStart(new Error('pull access denied for postgres'))).toBe('image-pull');
  });

  it('treats a wait-strategy timeout as a startup problem', () => {
    expect(classifyContainerStart(new Error('container did not become ready in time'))).toBe('startup');
  });
});

describe('withoutSecrets', () => {
  it('replaces secrets so failure text does not contain them', () => {
    const secret = 'synthetic-app-password';
    const text = withoutSecrets(`url=postgres://u:${secret}@127.0.0.1/db`, [secret]);
    expect(countOccurrences(text, secret)).toBe(0);
    expect(text).toContain('[REDACTED]');
  });
});
