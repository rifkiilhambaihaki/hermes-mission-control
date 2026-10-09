import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

export const FRONTEND_INDEX_MAX_BYTES = 256 * 1024;
export const FRONTEND_ASSET_MAX_BYTES = 4 * 1024 * 1024;

export interface FrontendAsset {
  readonly body: Buffer;
  readonly contentType: "text/javascript; charset=utf-8" | "text/css; charset=utf-8";
}

export interface FrontendAssetBundle {
  readonly indexHtml: Buffer;
  readonly assets: ReadonlyMap<string, FrontendAsset>;
}

const RESOURCE_REFERENCE = /(?:src|href)=["']([^"']+)["']/g;
const APPROVED_ASSET_PATH = /^\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*\.(js|css))$/;
const APPROVED_CHILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function descriptorRoot(directory: FileHandle): string {
  return `/proc/self/fd/${directory.fd}`;
}

function descriptorChild(directory: FileHandle, childName: string): string {
  if (!APPROVED_CHILD_NAME.test(childName)) {
    throw new Error("Frontend build child name failed strict validation.");
  }
  return `${descriptorRoot(directory)}/${childName}`;
}

async function openNoFollowDirectory(path: string): Promise<FileHandle> {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const metadata = await directory.stat();
  if (!metadata.isDirectory()) {
    await directory.close();
    throw new Error("Frontend build path is not a directory.");
  }
  return directory;
}

async function readNoFollowFile(
  directory: FileHandle,
  filename: string,
  maximumBytes: number,
): Promise<Buffer> {
  const handle = await open(
    descriptorChild(directory, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error("Frontend build file violates the bounded file contract.");
    }
    const bounded = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < bounded.length) {
      const { bytesRead } = await handle.read(
        bounded,
        offset,
        bounded.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      throw new Error("Frontend build file exceeds the bounded file contract.");
    }
    return bounded.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function referencedAssets(indexHtml: string): readonly string[] {
  const references = [...indexHtml.matchAll(RESOURCE_REFERENCE)].map((match) => match[1] ?? "");
  if (references.length === 0) {
    throw new Error("Frontend index does not reference any production assets.");
  }
  const unique = new Set<string>();
  for (const reference of references) {
    if (!APPROVED_ASSET_PATH.test(reference)) {
      throw new Error("Frontend index contains a non-approved asset reference.");
    }
    unique.add(reference);
  }
  return [...unique].sort();
}

function contentType(path: string): FrontendAsset["contentType"] {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  throw new Error("Frontend asset type is not approved.");
}

export async function loadFrontendAssets(buildDirectory: string): Promise<FrontendAssetBundle> {
  const approvedRoot = resolve(buildDirectory);
  const rootDirectory = await openNoFollowDirectory(approvedRoot);
  try {
    const canonicalRoot = await realpath(descriptorRoot(rootDirectory));
    if (canonicalRoot !== approvedRoot) {
      throw new Error("Frontend build directory must not be a symbolic link.");
    }
    const indexHtml = await readNoFollowFile(
      rootDirectory,
      "index.html",
      FRONTEND_INDEX_MAX_BYTES,
    );
    const references = referencedAssets(indexHtml.toString("utf8"));
    const assetsDirectory = await openNoFollowDirectory(
      descriptorChild(rootDirectory, "assets"),
    );
    try {
      const assets = new Map<string, FrontendAsset>();
      for (const publicPath of references) {
        const filename = APPROVED_ASSET_PATH.exec(publicPath)?.[1];
        if (filename === undefined) {
          throw new Error("Frontend asset path failed strict validation.");
        }
        assets.set(publicPath, {
          body: await readNoFollowFile(
            assetsDirectory,
            filename,
            FRONTEND_ASSET_MAX_BYTES,
          ),
          contentType: contentType(publicPath),
        });
      }
      return Object.freeze({ indexHtml, assets });
    } finally {
      await assetsDirectory.close();
    }
  } finally {
    await rootDirectory.close();
  }
}
