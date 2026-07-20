import { constants } from 'node:fs';
import { access, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { blocked } from './errors.mjs';

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomic(filePath, payload, { force = false } = {}) {
  const target = path.resolve(filePath);
  if (await exists(target) && !force) {
    blocked('output_exists', `输出已存在，拒绝覆盖: ${target}（如确认替换，显式传 --force）`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o644);
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    if (error?.reasonCode) throw error;
    blocked('atomic_write_failed', `原子写出失败: ${target}`, [error.message]);
  }
  return target;
}
