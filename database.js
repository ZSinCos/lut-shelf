const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

  /* ── Scan & Sync ── */

  scanAndSync(dirPath) {
    const existingPaths = new Set(
      this.db.prepare('SELECT path FROM luts').all().map(r => r.path)
    );
    const foundPaths = new Set();

    const walk = (absDir, parentId) => {
      let entries;
      try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
      catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
          const folderId = this._ensureFolder(full, parentId);
          walk(full, folderId);
        } else if (entry.isFile() && LUT_EXTS.has(path.extname(entry.name).toLowerCase())) {
          foundPaths.add(full);
          if (existingPaths.has(full)) {
            const stat = fs.statSync(full);
            const row = this.db.prepare('SELECT mtime, file_size FROM luts WHERE path = ?').get(full);
            if (row && (row.mtime !== stat.mtimeMs || row.file_size !== stat.size)) {
              this._upsertLut(full, parentId);
            }
          } else {
            this._upsertLut(full, parentId);
          }
        }
      }
    };

    const rootId = this._ensureFolder(dirPath, null);
    walk(dirPath, rootId);

    const removed = [...existingPaths].filter(p => !foundPaths.has(p));
    for (const p of removed) {
      this.db.prepare('DELETE FROM luts WHERE path = ?').run(p);
    }

    this._cleanFolders();

    return { total: foundPaths.size, added: foundPaths.size - existingPaths.size, removed: removed.length };
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

  _ensureFolder(absPath, parentId) {
    const existing = this.db.prepare('SELECT id FROM folders WHERE path = ?').get(absPath);
    if (existing) return existing.id;
    const name = path.basename(absPath);
    const result = this.db.prepare('INSERT INTO folders (path, name, parent_id) VALUES (?, ?, ?)').run(absPath, name, parentId);
    return result.lastInsertRowid;
  }

  _upsertLut(fullPath, folderId) {
    const name = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const stat = fs.statSync(fullPath);
    let lutSize = 0;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const m = content.match(/LUT_3D_SIZE\s+(\d+)/i);
      lutSize = m ? parseInt(m[1], 10) : 0;
    } catch {}
    const existing = this.db.prepare('SELECT id FROM luts WHERE path = ?').get(fullPath);
    if (existing) {
      this.db.prepare(`
        UPDATE luts SET folder_id=?, format=?, lut_size=?, file_size=?, mtime=?, updated_at=datetime('now','localtime')
        WHERE path=?
      `).run(folderId, ext.slice(1), lutSize, stat.size, stat.mtimeMs, fullPath);
    } else {
      this.db.prepare(`
        INSERT INTO luts (path, name, folder_id, format, lut_size, file_size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(fullPath, name, folderId, ext.slice(1), lutSize, stat.size, stat.mtimeMs);
    }
  }

  _cleanFolders() {
    const orphans = this.db.prepare(`
      SELECT f.id FROM folders f
      LEFT JOIN luts l ON l.folder_id = f.id
      LEFT JOIN folders child ON child.parent_id = f.id
      WHERE l.id IS NULL AND child.id IS NULL AND f.parent_id IS NOT NULL
    `).all();
    for (const o of orphans) {
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(o.id);
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
          id: l.id,
          name: l.name,
          path: l.path,
          format: l.format,
          lut_size: l.lut_size,
          file_size: l.file_size,
          mtime: l.mtime,
          notes: l.notes,
          author: l.author,
          description: l.description,
        });
      }
    }
    const toApi = (folder) => ({
      name: folder.name,
      path: folder.path,
      folders: folder.folders.map(toApi),
      files: folder.files,
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
