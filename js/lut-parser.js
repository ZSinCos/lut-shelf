class LUTParser {
  static async parseLUT(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const text = await file.text();

    switch (ext) {
      case 'cube':
        return LUTParser.parseCube(text, file.name);
      case 'vlt':
        return LUTParser.parseVLT(text, file.name);
      default:
        throw new Error(`不支持的 LUT 格式: .${ext}`);
    }
  }

  static parseLUTFromText(fileName, text) {
    const ext = fileName.split('.').pop().toLowerCase();
    switch (ext) {
      case 'cube':
        return LUTParser.parseCube(text, fileName);
      case 'vlt':
        return LUTParser.parseVLT(text, fileName);
      default:
        throw new Error(`不支持的 LUT 格式: .${ext}`);
    }
  }

  static parseCube(text, name) {
    const lines = text.split(/\r?\n/);
    let size = 33;
    let title = name;
    const data = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('TITLE')) {
        title = trimmed.split(/["']/)[1] || name;
        continue;
      }
      if (trimmed.startsWith('LUT_3D_SIZE')) {
        size = parseInt(trimmed.split(/\s+/)[1], 10);
        continue;
      }
      if (trimmed.startsWith('DOMAIN_MIN') || trimmed.startsWith('DOMAIN_MAX')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length === 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          data.push([r, g, b]);
        }
      }
    }

    const expected = size * size * size;
    if (data.length !== expected) {
      console.warn(`[LUT] ${name}: 期望 ${expected} 个条目，实际 ${data.length} 个`);
    }

    return { name, size, data, type: 'cube' };
  }

  static parseVLT(text, name) {
    const lines = text.split(/\r?\n/);
    const data = [];
    let size = 0;
    let inData = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('LUT_3D_SIZE')) {
        size = parseInt(trimmed.split(/\s+/)[1], 10);
        inData = true;
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length === 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          data.push([r / 4095, g / 4095, b / 4095]);
        }
      }
    }

    if (!size) {
      size = Math.round(Math.cbrt(data.length));
    }

    console.log(`[LUT] 解析 .vlt: "${name}" size=${size}, 条目=${data.length}`);
    return { name, size, data, type: 'vlt' };
  }

  static sampleLUT(lut, r, g, b) {
    const { data, size } = lut;
    const s = size - 1;

    const fr = r * s;
    const fg = g * s;
    const fb = b * s;

    const ir = Math.min(Math.floor(fr), s - 1);
    const ig = Math.min(Math.floor(fg), s - 1);
    const ib = Math.min(Math.floor(fb), s - 1);

    const dr = fr - ir;
    const dg = fg - ig;
    const db = fb - ib;

    const strideG = size;
    const strideB = size * size;

    const idx = ir + ig * strideG + ib * strideB;

    const c000 = data[idx] || [0, 0, 0];
    const c100 = data[Math.min(idx + 1, data.length - 1)] || [0, 0, 0];
    const c010 = data[Math.min(idx + strideG, data.length - 1)] || [0, 0, 0];
    const c110 = data[Math.min(idx + strideG + 1, data.length - 1)] || [0, 0, 0];
    const c001 = data[Math.min(idx + strideB, data.length - 1)] || [0, 0, 0];
    const c101 = data[Math.min(idx + strideB + 1, data.length - 1)] || [0, 0, 0];
    const c011 = data[Math.min(idx + strideB + strideG, data.length - 1)] || [0, 0, 0];
    const c111 = data[Math.min(idx + strideB + strideG + 1, data.length - 1)] || [0, 0, 0];

    const lerp = (a, b, t) => a + (b - a) * t;

    const c00 = [lerp(c000[0], c100[0], dr), lerp(c000[1], c100[1], dr), lerp(c000[2], c100[2], dr)];
    const c10 = [lerp(c010[0], c110[0], dr), lerp(c010[1], c110[1], dr), lerp(c010[2], c110[2], dr)];
    const c01 = [lerp(c001[0], c101[0], dr), lerp(c001[1], c101[1], dr), lerp(c001[2], c101[2], dr)];
    const c11 = [lerp(c011[0], c111[0], dr), lerp(c011[1], c111[1], dr), lerp(c011[2], c111[2], dr)];

    const c0 = [lerp(c00[0], c10[0], dg), lerp(c00[1], c10[1], dg), lerp(c00[2], c10[2], dg)];
    const c1 = [lerp(c01[0], c11[0], dg), lerp(c01[1], c11[1], dg), lerp(c01[2], c11[2], dg)];

    return [lerp(c0[0], c1[0], db), lerp(c0[1], c1[1], db), lerp(c0[2], c1[2], db)];
  }
}
