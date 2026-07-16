const LUTColor = {
  srgbToLinear(c) {
    if (c <= 0.04045) return c / 12.92;
    return Math.pow((c + 0.055) / 1.055, 2.4);
  },

  linearToVLog(l) {
    const cut = 0.01;
    const b = 0.00873;
    const c = 0.241514;
    const d = 0.598206;
    if (l < cut) return 5.6 * l + 0.125;
    return c * Math.log10(l + b) + d;
  },

  prepareInput(r, g, b, lutType) {
    if (lutType === 'vlt') {
      const lr = this.srgbToLinear(r);
      const lg = this.srgbToLinear(g);
      const lb = this.srgbToLinear(b);
      return [this.linearToVLog(lr), this.linearToVLog(lg), this.linearToVLog(lb)];
    }
    return [r, g, b];
  }
};

class LUTApply {
  static applyLUT(imageData, lut) {
    const { data } = imageData;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const [vr, vg, vb] = LUTColor.prepareInput(r, g, b, lut.type);
      const [or, og, ob] = LUTParser.sampleLUT(lut, vr, vg, vb);

      data[i]     = Math.round(Math.max(0, Math.min(255, or * 255)));
      data[i + 1] = Math.round(Math.max(0, Math.min(255, og * 255)));
      data[i + 2] = Math.round(Math.max(0, Math.min(255, ob * 255)));
    }
  }

  static applyLUTWithSplit(imageData, lut, splitRatio) {
    const { data, width } = imageData;
    const len = data.length;
    const splitCol = Math.round(width * splitRatio);

    for (let i = 0; i < len; i += 4) {
      const px = (i / 4) % width;
      if (px < splitCol) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const [vr, vg, vb] = LUTColor.prepareInput(r, g, b, lut.type);
        const [or, og, ob] = LUTParser.sampleLUT(lut, vr, vg, vb);
        data[i]     = Math.round(Math.max(0, Math.min(255, or * 255)));
        data[i + 1] = Math.round(Math.max(0, Math.min(255, og * 255)));
        data[i + 2] = Math.round(Math.max(0, Math.min(255, ob * 255)));
      }
    }
  }
}
