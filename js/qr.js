(function() {
  const QUIET_ZONE = 4;
  const EC_LEVEL_BITS = 1;
  const encoder = new TextEncoder();
  const generatorCache = {};
  const QR_SPECS = [
    {
      version: 10,
      size: 57,
      byteCapacity: 271,
      ecCodewordsPerBlock: 18,
      groups: [
        { count: 2, dataCodewords: 68 },
        { count: 2, dataCodewords: 69 },
      ],
      alignmentCenters: [6, 28, 50],
      remainderBits: 0,
    },
    {
      version: 12,
      size: 65,
      byteCapacity: 367,
      ecCodewordsPerBlock: 24,
      groups: [
        { count: 2, dataCodewords: 92 },
        { count: 2, dataCodewords: 93 },
      ],
      alignmentCenters: [6, 32, 58],
      remainderBits: 0,
    },
    {
      version: 15,
      size: 77,
      byteCapacity: 520,
      ecCodewordsPerBlock: 22,
      groups: [
        { count: 5, dataCodewords: 87 },
        { count: 1, dataCodewords: 88 },
      ],
      alignmentCenters: [6, 26, 48, 70],
      remainderBits: 3,
    },
  ];

  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);

  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }

  for (let i = 255; i < GF_EXP.length; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }

  function chooseSpec(byteLength) {
    for (let i = 0; i < QR_SPECS.length; i++) {
      if (byteLength <= QR_SPECS[i].byteCapacity) return QR_SPECS[i];
    }

    return null;
  }

  function appendBits(buffer, value, length) {
    for (let i = length - 1; i >= 0; i--) {
      buffer.push((value >>> i) & 1);
    }
  }

  function bitsToCodewords(bits) {
    const codewords = [];

    for (let offset = 0; offset < bits.length; offset += 8) {
      let value = 0;
      for (let i = 0; i < 8; i++) {
        value = (value << 1) | bits[offset + i];
      }
      codewords.push(value);
    }

    return codewords;
  }

  function multiplyGalois(left, right) {
    if (left === 0 || right === 0) return 0;
    return GF_EXP[GF_LOG[left] + GF_LOG[right]];
  }

  function getGeneratorPolynomial(degree) {
    if (generatorCache[degree]) return generatorCache[degree];

    let polynomial = [1];

    for (let i = 0; i < degree; i++) {
      const next = new Array(polynomial.length + 1).fill(0);
      for (let j = 0; j < polynomial.length; j++) {
        next[j] ^= polynomial[j];
        next[j + 1] ^= multiplyGalois(polynomial[j], GF_EXP[i]);
      }
      polynomial = next;
    }

    generatorCache[degree] = polynomial;
    return polynomial;
  }

  function buildErrorCorrectionCodewords(dataCodewords, ecCount) {
    const generator = getGeneratorPolynomial(ecCount);
    const message = dataCodewords.concat(new Array(ecCount).fill(0));

    for (let i = 0; i < dataCodewords.length; i++) {
      const factor = message[i];
      if (factor === 0) continue;

      for (let j = 0; j < generator.length; j++) {
        message[i + j] ^= multiplyGalois(generator[j], factor);
      }
    }

    return message.slice(message.length - ecCount);
  }

  function buildFinalBits(text, spec) {
    const bytes = Array.from(encoder.encode(text));
    const maxDataBits = spec.groups.reduce(function(total, group) {
      return total + group.count * group.dataCodewords * 8;
    }, 0);
    const byteCountBits = spec.version < 10 ? 8 : 16;
    const dataBits = [];

    appendBits(dataBits, 0x4, 4);
    appendBits(dataBits, bytes.length, byteCountBits);
    for (let i = 0; i < bytes.length; i++) appendBits(dataBits, bytes[i], 8);

    const terminatorLength = Math.min(4, maxDataBits - dataBits.length);
    appendBits(dataBits, 0, terminatorLength);

    while (dataBits.length % 8 !== 0) dataBits.push(0);

    const dataCodewords = bitsToCodewords(dataBits);
    const padCodewords = [0xec, 0x11];
    while (dataCodewords.length < maxDataBits / 8) {
      dataCodewords.push(padCodewords[dataCodewords.length % 2]);
    }

    const dataBlocks = [];
    let offset = 0;
    for (let i = 0; i < spec.groups.length; i++) {
      const group = spec.groups[i];
      for (let j = 0; j < group.count; j++) {
        const nextOffset = offset + group.dataCodewords;
        dataBlocks.push(dataCodewords.slice(offset, nextOffset));
        offset = nextOffset;
      }
    }

    const ecBlocks = dataBlocks.map(function(block) {
      return buildErrorCorrectionCodewords(block, spec.ecCodewordsPerBlock);
    });

    const codewords = [];
    const maxBlockLength = dataBlocks.reduce(function(max, block) {
      return Math.max(max, block.length);
    }, 0);

    for (let i = 0; i < maxBlockLength; i++) {
      for (let j = 0; j < dataBlocks.length; j++) {
        if (i < dataBlocks[j].length) codewords.push(dataBlocks[j][i]);
      }
    }

    for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
      for (let j = 0; j < ecBlocks.length; j++) {
        codewords.push(ecBlocks[j][i]);
      }
    }

    const finalBits = [];
    for (let i = 0; i < codewords.length; i++) appendBits(finalBits, codewords[i], 8);
    for (let i = 0; i < spec.remainderBits; i++) finalBits.push(0);

    return finalBits;
  }

  function createMatrix(size) {
    return {
      modules: Array.from({ length: size }, function() { return Array(size).fill(null); }),
      reserved: Array.from({ length: size }, function() { return Array(size).fill(false); }),
    };
  }

  function setFunctionModule(matrix, x, y, value) {
    if (x < 0 || y < 0 || x >= matrix.modules.length || y >= matrix.modules.length) return;
    matrix.modules[y][x] = value;
    matrix.reserved[y][x] = true;
  }

  function placeFinderPattern(matrix, left, top) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const xx = left + x;
        const yy = top + y;
        const isFinder =
          x >= 0 && x <= 6 && y >= 0 && y <= 6 &&
          (x === 0 || x === 6 || y === 0 || y === 6 ||
            (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setFunctionModule(matrix, xx, yy, isFinder);
      }
    }
  }

  function placeAlignmentPatterns(matrix, spec) {
    const centers = spec.alignmentCenters;

    for (let cy = 0; cy < centers.length; cy++) {
      for (let cx = 0; cx < centers.length; cx++) {
        const centerX = centers[cx];
        const centerY = centers[cy];
        if (matrix.reserved[centerY][centerX]) continue;

        for (let y = -2; y <= 2; y++) {
          for (let x = -2; x <= 2; x++) {
            const distance = Math.max(Math.abs(x), Math.abs(y));
            setFunctionModule(matrix, centerX + x, centerY + y, distance !== 1);
          }
        }
      }
    }
  }

  function placeTimingPatterns(matrix) {
    const size = matrix.modules.length;

    for (let i = 8; i < size - 8; i++) {
      if (!matrix.reserved[6][i]) setFunctionModule(matrix, i, 6, i % 2 === 0);
      if (!matrix.reserved[i][6]) setFunctionModule(matrix, 6, i, i % 2 === 0);
    }
  }

  function getFormatVerticalCoord(size, index) {
    if (index < 6) return { x: 8, y: index };
    if (index < 8) return { x: 8, y: index + 1 };
    return { x: 8, y: size - 15 + index };
  }

  function getFormatHorizontalCoord(size, index) {
    if (index < 8) return { x: size - index - 1, y: 8 };
    if (index < 9) return { x: 7, y: 8 };
    return { x: 15 - index - 1, y: 8 };
  }

  function reserveFormatInformation(matrix) {
    const size = matrix.modules.length;

    for (let i = 0; i < 15; i++) {
      const vertical = getFormatVerticalCoord(size, i);
      const horizontal = getFormatHorizontalCoord(size, i);
      setFunctionModule(matrix, vertical.x, vertical.y, false);
      setFunctionModule(matrix, horizontal.x, horizontal.y, false);
    }
  }

  function reserveVersionInformation(matrix, version) {
    if (version < 7) return;

    const size = matrix.modules.length;
    for (let i = 0; i < 18; i++) {
      const x = size - 11 + (i % 3);
      const y = Math.floor(i / 3);
      setFunctionModule(matrix, x, y, false);
      setFunctionModule(matrix, y, x, false);
    }
  }

  function bitLength(value) {
    let length = 0;
    while (value !== 0) {
      length++;
      value >>>= 1;
    }
    return length;
  }

  function getBchRemainder(value, polynomial) {
    let current = value;
    const polynomialLength = bitLength(polynomial);

    while (bitLength(current) >= polynomialLength) {
      current ^= polynomial << (bitLength(current) - polynomialLength);
    }

    return current;
  }

  function getFormatBits(mask) {
    const data = (EC_LEVEL_BITS << 3) | mask;
    const remainder = getBchRemainder(data << 10, 0x537);
    return ((data << 10) | remainder) ^ 0x5412;
  }

  function getVersionBits(version) {
    const remainder = getBchRemainder(version << 12, 0x1f25);
    return (version << 12) | remainder;
  }

  function placeFormatInformation(matrix, mask) {
    const size = matrix.modules.length;
    const bits = getFormatBits(mask);

    for (let i = 0; i < 15; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const vertical = getFormatVerticalCoord(size, i);
      const horizontal = getFormatHorizontalCoord(size, i);
      setFunctionModule(matrix, vertical.x, vertical.y, bit);
      setFunctionModule(matrix, horizontal.x, horizontal.y, bit);
    }
  }

  function placeVersionInformation(matrix, version) {
    if (version < 7) return;

    const size = matrix.modules.length;
    const bits = getVersionBits(version);

    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const x = size - 11 + (i % 3);
      const y = Math.floor(i / 3);
      setFunctionModule(matrix, x, y, bit);
      setFunctionModule(matrix, y, x, bit);
    }
  }

  function placeDataBits(matrix, bits, mask) {
    const size = matrix.modules.length;
    let bitIndex = 0;
    let movesUp = true;

    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right--;

      for (let i = 0; i < size; i++) {
        const y = movesUp ? size - 1 - i : i;

        for (let dx = 0; dx < 2; dx++) {
          const x = right - dx;
          if (matrix.reserved[y][x]) continue;

          const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
          const maskedBit = bit ^ (((x + y) % 2 === 0 && mask === 0) ? 1 : 0);
          matrix.modules[y][x] = maskedBit === 1;
          bitIndex++;
        }
      }

      movesUp = !movesUp;
    }
  }

  function renderMatrixToCanvas(canvas, modules, size) {
    const totalModules = modules.length + QUIET_ZONE * 2;
    const context = canvas.getContext('2d');
    if (!context) return false;

    canvas.width = size;
    canvas.height = size;
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);

    context.fillStyle = '#111827';
    for (let y = 0; y < modules.length; y++) {
      for (let x = 0; x < modules.length; x++) {
        if (!modules[y][x]) continue;

        const left = Math.floor(((x + QUIET_ZONE) * size) / totalModules);
        const top = Math.floor(((y + QUIET_ZONE) * size) / totalModules);
        const right = Math.ceil(((x + QUIET_ZONE + 1) * size) / totalModules);
        const bottom = Math.ceil(((y + QUIET_ZONE + 1) * size) / totalModules);
        context.fillRect(left, top, right - left, bottom - top);
      }
    }

    return true;
  }

  function buildModules(text, spec) {
    const matrix = createMatrix(spec.size);
    const mask = 0;
    const bits = buildFinalBits(text, spec);

    placeFinderPattern(matrix, 0, 0);
    placeFinderPattern(matrix, spec.size - 7, 0);
    placeFinderPattern(matrix, 0, spec.size - 7);
    placeAlignmentPatterns(matrix, spec);
    placeTimingPatterns(matrix);
    reserveFormatInformation(matrix);
    reserveVersionInformation(matrix, spec.version);
    setFunctionModule(matrix, 8, spec.size - 8, true);
    placeDataBits(matrix, bits, mask);
    placeFormatInformation(matrix, mask);
    placeVersionInformation(matrix, spec.version);

    return matrix.modules;
  }

  window.renderQrCodeToCanvas = function(canvas, text, size) {
    const bytes = encoder.encode(text);
    const spec = chooseSpec(bytes.length);
    if (!spec) return false;

    const modules = buildModules(text, spec);
    const rendered = renderMatrixToCanvas(canvas, modules, size);

    if (!rendered) return false;

    canvas.dataset.qrVersion = String(spec.version);
    canvas.dataset.qrEncodedLength = String(bytes.length);
    return true;
  };
})();