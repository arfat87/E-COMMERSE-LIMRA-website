import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = "https://vb9ucr22.us-east.insforge.app";
const API_KEY = "ik_799af068e8f4fb05944d04497229fe7d";
const SOURCE_DIR = path.resolve(__dirname, "../frontend/dist");


async function hashFile(filePath) {
  const hash = createHash('sha1');
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { sha: hash.digest('hex'), size };
}

async function collectFiles(rootDirectory) {
  const files = [];
  async function walk(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const normalizedPath = path.relative(rootDirectory, absolutePath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        if (entry.name === '.DS_Store' || entry.name.endsWith('.log')) continue;
        const { sha, size } = await hashFile(absolutePath);
        files.push({ absolutePath, path: normalizedPath, sha, size });
      }
    }
  }
  await walk(rootDirectory);
  return files;
}

async function run() {
  console.log(`Scanning directory: ${SOURCE_DIR}`);
  const localFiles = await collectFiles(SOURCE_DIR);
  console.log(`Found ${localFiles.length} files to deploy.`);

  console.log("Creating deployment session...");
  const res = await fetch(`${API_BASE_URL}/api/deployments/direct`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: localFiles.map(({ path, sha, size }) => ({ path, sha, size }))
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create deployment session: ${res.status} ${errText}`);
  }

  const session = await res.json();
  const deploymentId = session.id;
  console.log(`Created deployment. ID: ${deploymentId}`);

  const filesToUpload = session.files;
  console.log(`Uploading ${filesToUpload.length} files...`);

  const localFileByPath = new Map(localFiles.map(f => [f.path, f]));

  // Upload with concurrency of 8
  const concurrency = 8;
  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= filesToUpload.length) break;
      const file = filesToUpload[currentIndex];
      const localFile = localFileByPath.get(file.path);
      if (!localFile) throw new Error(`Unknown file in response: ${file.path}`);

      // Upload file content
      const uploadRes = await fetch(`${API_BASE_URL}/api/deployments/${encodeURIComponent(deploymentId)}/files/${encodeURIComponent(file.fileId)}/content`, {
        method: 'PUT',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(localFile.size)
        },
        body: createReadStream(localFile.absolutePath),
        duplex: 'half'
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Failed to upload ${file.path}: ${uploadRes.status} ${errText}`);
      }
      console.log(`[${currentIndex + 1}/${filesToUpload.length}] Uploaded: ${file.path}`);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, filesToUpload.length) }, worker);
  await Promise.all(workers);
  console.log("All files uploaded. Triggering build...");

  const startRes = await fetch(`${API_BASE_URL}/api/deployments/${encodeURIComponent(deploymentId)}/start`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Failed to start deployment: ${startRes.status} ${errText}`);
  }

  const startResult = await startRes.json();
  console.log("Deployment started:", JSON.stringify(startResult, null, 2));

  // Poll for deployment completion and URL
  console.log("Polling deployment status...");
  while (true) {
    const statusRes = await fetch(`${API_BASE_URL}/api/deployments/${encodeURIComponent(deploymentId)}`, {
      headers: { 'x-api-key': API_KEY }
    });
    if (!statusRes.ok) {
      console.warn(`Failed to fetch deployment status (HTTP ${statusRes.status}), will try querying project metadata...`);
      break;
    } else {
      const statusResult = await statusRes.json();
      const status = String(statusResult.status || statusResult.state || '').toLowerCase();
      console.log(`Status: ${statusResult.status || statusResult.state} (normalized: ${status})`);
      if (status === 'ready' || status === 'success' || status === 'ready_for_promotion') {
        console.log(`Deployment SUCCESSFUL!`);
        console.log(`Live URL: ${statusResult.deploymentUrl || statusResult.url}`);
        break;
      }
      if (status === 'failed' || status === 'canceled') {
        throw new Error(`Deployment failed with status: ${statusResult.status}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

run().catch(console.error);
