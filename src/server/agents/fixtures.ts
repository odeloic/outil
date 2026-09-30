import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeFakeBinDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "outil-fake-bin-"));
}

export async function writeFake(dir: string, name: string, script: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, `#!/bin/bash\n${script}`);
  await chmod(file, 0o755);
  return file;
}

export function fakeEnv(dir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra, PATH: `${dir}:/usr/bin:/bin` };
}
