import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceThreeRoot = path.resolve(
  __dirname,
  '../../../../node_modules/three',
);
const avatarDir = path.resolve(__dirname, 'public/avatar');

function avatarManifestPlugin(): Plugin {
  const writeManifest = () => {
    fs.mkdirSync(avatarDir, { recursive: true });
    const files = fs
      .readdirSync(avatarDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fbx'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en'));

    fs.writeFileSync(
      path.join(avatarDir, 'manifest.json'),
      `${JSON.stringify({ files }, null, 2)}\n`,
      'utf-8',
    );
  };

  return {
    name: 'avatar-manifest',
    buildStart() {
      writeManifest();
    },
    configureServer(server) {
      writeManifest();
      server.watcher.add(avatarDir);
      server.watcher.on('all', (_event, changedPath) => {
        if (path.dirname(changedPath) === avatarDir) {
          writeManifest();
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^three$/,
        replacement: path.resolve(workspaceThreeRoot, 'build/three.module.js'),
      },
      {
        find: /^three\/examples\/jsm\/(.*)$/,
        replacement: `${path.resolve(workspaceThreeRoot, 'examples/jsm')}/$1`,
      },
    ],
  },
  plugins: [avatarManifestPlugin(), react()],
});
