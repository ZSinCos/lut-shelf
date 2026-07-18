const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const LUT_EXTS = new Set(['.vlt', '.cube', '.3dl', '.csp']);

class LutDB {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        parent_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS luts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        folder_id INTEGER NOT NULL,
        format TEXT NOT NULL DEFAULT '',
        lut_size INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        mtime REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_luts_folder ON luts(folder_id);
      CREATE INDEX IF NOT EXISTS idx_luts_path ON luts(path);
      CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    `);
  }

  close() {
    this.db.close();
  }

  /* ── Async Scan & Sync ── */

  async scanAndSync(dirPath, onProgress) {
    const existingPaths = new Set(
      this.db.prepare('SELECT path FROM luts').all().map(r => r.path)
    );
    const foundPaths = new Set();
    const insertFolder = this.db.prepare('INSERT OR IGNORE INTO folders (path, name, parent_id) VALUES (?, ?, ?)');
    const selectFolder = this.db.prepare('SELECT id FROM folders WHERE path = ?');
    const selectLut = this.db.prepare('SELECT id, mtime, file_size FROM luts WHERE path = ?');
    const updateLut = this.db.prepare(`
      UPDATE luts SET folder_id=?, format=?, file_size=?, mtime=?, updated_at=datetime('now','localtime')
      WHERE path=?
    `);
    const insertLut = this.db.prepare(`
      INSERT OR IGNORE INTO luts (path, name, folder_id, format, file_size, mtime)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let total = 0;

    const ensureFolder = (absPath, parentId) => {
      const existing = selectFolder.get(absPath);
      if (existing) return existing.id;
      insertFolder.run(absPath, path.basename(absPath), parentId);
      return selectFolder.get(absPath).id;
    };

    const walk = async (absDir, parentId) => {
      let entries;
      try { entries = await fsp.readdir(absDir, { withFileTypes: true }); }
      catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
          const folderId = ensureFolder(full, parentId);
          await walk(full, folderId);
        } else if (entry.isFile() && LUT_EXTS.has(path.extname(entry.name).toLowerCase())) {
          foundPaths.add(full);
          total++;
          if (total % 100 === 0 && onProgress) onProgress(total, 0, 0, false);
          const stat = await fsp.stat(full);
          const ext = path.extname(entry.name).toLowerCase().slice(1);
          const existing = selectLut.get(full);
          if (existing) {
            if (existing.mtime !== stat.mtimeMs || existing.file_size !== stat.size) {
              updateLut.run(parentId, ext, stat.size, stat.mtimeMs, full);
            }
          } else {
            insertLut.run(full, entry.name, parentId, ext, stat.size, stat.mtimeMs);
          }
        }
      }
    };

    const rootId = ensureFolder(dirPath, null);
    await walk(dirPath, rootId);

    const removed = [...existingPaths].filter(p => !foundPaths.has(p));
    const delLut = this.db.prepare('DELETE FROM luts WHERE path = ?');
    for (const p of removed) {
      delLut.run(p);
    }

    if (onProgress) onProgress(total, foundPaths.size - existingPaths.size, removed.length, true);
    this._cleanFolders();
    return { total: foundPaths.size, added: foundPaths.size - existingPaths.size, removed: removed.length };
  }

  _cleanFolders() {
    const orphans = this.db.prepare(`
      SELECT f.id FROM folders f
      LEFT JOIN luts l ON l.folder_id = f.id
      LEFT JOIN folders child ON child.parent_id = f.id
      WHERE l.id IS NULL AND child.id IS NULL AND f.parent_id IS NOT NULL
    `).all();
    const del = this.db.prepare('DELETE FROM folders WHERE id = ?');
    for (const o of orphans) del.run(o.id);
  }

  quickCheck(dirPath) {
    let changed = false;
    const walk = (absDir) => {
      let entries;
      try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && LUT_EXTS.has(path.extname(entry.name).toLowerCase())) {
          const row = this.db.prepare('SELECT mtime, file_size FROM luts WHERE path = ?').get(full);
          if (!row) { changed = true; return; }
          try {
            const stat = fs.statSync(full);
            if (stat.mtimeMs !== row.mtime || stat.size !== row.file_size) { changed = true; return; }
          } catch { changed = true; return; }
        }
      }
    };
    walk(dirPath);
    return changed;
  }

  /* ── Lazy LUT size parsing ── */

  parseAndSaveLutSize(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const m = content.match(/LUT_3D_SIZE\s+(\d+)/i);
      const size = m ? parseInt(m[1], 10) : 0;
      if (size) {
        this.db.prepare("UPDATE luts SET lut_size = ?, updated_at = datetime('now','localtime') WHERE path = ?").run(size, filePath);
      }
      return size;
    } catch {
      return 0;
    }
  }

  /* ── Queries ── */

  getTree() {
    const folders = this.db.prepare('SELECT * FROM folders ORDER BY name').all();
    const luts = this.db.prepare('SELECT * FROM luts ORDER BY name').all();
    const folderMap = new Map();
    for (const f of folders) {
      f.folders = [];
      f.files = [];
      folderMap.set(f.id, f);
    }
    const roots = [];
    for (const f of folders) {
      if (f.parent_id && folderMap.has(f.parent_id)) {
        folderMap.get(f.parent_id).folders.push(f);
      } else {
        roots.push(f);
      }
    }
    for (const l of luts) {
      if (folderMap.has(l.folder_id)) {
        folderMap.get(l.folder_id).files.push({
          id: l.id, name: l.name, path: l.path, format: l.format,
          lut_size: l.lut_size, file_size: l.file_size, mtime: l.mtime,
          notes: l.notes, author: l.author, description: l.description,
        });
      }
    }
    const toApi = (folder) => ({
      name: folder.name,
      children: {
        folders: folder.folders.map(toApi),
        files: folder.files,
      },
    });
    return { folders: roots.map(toApi), files: [] };
  }

  getLutByPath(filePath) {
    return this.db.prepare('SELECT * FROM luts WHERE path = ?').get(filePath);
  }

  updateNotes(path, notes) {
    this.db.prepare("UPDATE luts SET notes = ?, updated_at = datetime('now','localtime') WHERE path = ?").run(notes, path);
  }

  updateAuthor(path, author) {
    this.db.prepare("UPDATE luts SET author = ?, updated_at = datetime('now','localtime') WHERE path = ?").run(author, path);
  }

  updateDescription(path, description) {
    this.db.prepare("UPDATE luts SET description = ?, updated_at = datetime('now','localtime') WHERE path = ?").run(description, path);
  }

  search(query) {
    const q = `%${query}%`;
    return this.db.prepare(`
      SELECT * FROM luts
      WHERE name LIKE ? OR path LIKE ? OR notes LIKE ? OR author LIKE ? OR description LIKE ?
      ORDER BY name
    `).all(q, q, q, q, q);
  }

  getFolderFiles(folderPath) {
    const folder = this.db.prepare('SELECT id FROM folders WHERE path = ?').get(folderPath);
    if (!folder) return [];
    const ids = [folder.id];
    const walk = (parentId) => {
      const children = this.db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(parentId);
      for (const c of children) { ids.push(c.id); walk(c.id); }
    };
    walk(folder.id);
    return this.db.prepare(`SELECT * FROM luts WHERE folder_id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids);
  }

  getAllStats() {
    const luts = this.db.prepare('SELECT COUNT(*) as count FROM luts').get();
    const folders = this.db.prepare('SELECT COUNT(*) as count FROM folders').get();
    return { luts: luts.count, folders: folders.count };
  }
}

module.exports = LutDB;
