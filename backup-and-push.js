#!/usr/bin/env node
// 로컬 폴더 백업 + Git 커밋/푸시 자동화 스크립트

import fs from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(projectDir, 'backup-config.json');

if (!fs.existsSync(configPath)) {
  console.error('❌ backup-config.json 파일을 찾을 수 없습니다.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const backupDir = path.resolve(projectDir, config.backupDir);
const excludedPaths = new Set(config.exclude);
let copiedCount = 0;

function isExcluded(relativePath) {
  return [...excludedPaths].some((excluded) => {
    if (!excluded.includes('/')) {
      return relativePath.split(path.sep).includes(excluded);
    }
    return (
      relativePath === excluded || relativePath.startsWith(`${excluded}${path.sep}`)
    );
  });
}

function copyRecursive(source, destination, relativePath = '') {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const entryRelativePath = path.join(relativePath, entry.name);
    if (isExcluded(entryRelativePath)) continue;

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destinationPath, entryRelativePath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
      copiedCount += 1;
    }
  }
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
}

function timestamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

console.log(`\n━━━ ${config.projectName} 로컬 백업 + Git Push ━━━\n`);
console.log(`📁 백업 위치: ${backupDir}`);
console.log(`   제외: ${config.exclude.join(', ')}`);

try {
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  copyRecursive(projectDir, backupDir);
  console.log(`✅ 로컬 백업 완료 (${copiedCount}개 파일)`);
} catch (error) {
  console.error(`❌ 로컬 백업 실패: ${error.message}`);
  process.exit(1);
}

try {
  git(['rev-parse', '--is-inside-work-tree'], { capture: true });
  git(['add', '-A']);

  const status = git(['status', '--porcelain'], { capture: true }).trim();
  if (status) {
    git(['commit', '-m', `[AUTO-BACKUP] ${timestamp()} - ${config.projectName} 백업`]);
  } else {
    console.log('ℹ️ 변경사항 없음 — 커밋을 생략합니다.');
  }

  const branch = git(['branch', '--show-current'], { capture: true }).trim();
  if (!branch) throw new Error('현재 Git 브랜치를 확인할 수 없습니다.');
  git(['push', '-u', 'origin', branch]);

  const commit = git(['rev-parse', '--short', 'HEAD'], { capture: true }).trim();
  console.log(`✅ Git 푸시 완료 (${branch} @ ${commit})`);
} catch (error) {
  console.error(`❌ Git 커밋 또는 푸시 실패: ${error.message}`);
  process.exit(1);
}

console.log('\n🎉 로컬 백업과 원격 푸시가 모두 완료되었습니다.\n');
