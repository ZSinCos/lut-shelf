class LUTApply {
  static applyLUT(imageData, lut) {
    const { data } = imageData;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const [or, og, ob] = LUTParser.sampleLUT(lut, r, g, b);

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
        const [or, og, ob] = LUTParser.sampleLUT(lut, r, g, b);
        data[i]     = Math.round(Math.max(0, Math.min(255, or * 255)));
        data[i + 1] = Math.round(Math.max(0, Math.min(255, og * 255)));
        data[i + 2] = Math.round(Math.max(0, Math.min(255, ob * 255)));
      }
    }
  }
}
