function optimizeFileChunks(files, options = {}) {
  const {
    // Maximum size of a single HTTP request (default 50MB)
    maxRequestSize = 50 * 1024 * 1024,
    // Maximum number of concurrent requests (default 10)
    maxConcurrentRequests = 10,
    // Maximum "gap" between files to include in same chunk (default 1MB)
    maxGapSize = 1024 * 1024,
  } = options;

  // Sort files by offset
  const sortedFiles = [...files].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  );

  const chunks = [];
  let currentChunk = {
    files: [],
    startOffset: -1,
    endOffset: -1,
    totalSize: 0,
  };

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const nextFile = sortedFiles[i + 1];

    // Start new chunk if this is first file
    if (currentChunk.startOffset === -1) {
      currentChunk.startOffset = file.localHeaderOffset;
      currentChunk.files.push(file);
      currentChunk.endOffset =
        file.localHeaderOffset + file.compressedSize + 1000; // Add buffer for headers
      currentChunk.totalSize = file.compressedSize + 1000;
      continue;
    }

    const gapToNext = nextFile
      ? nextFile.localHeaderOffset - currentChunk.endOffset
      : Infinity;
    const wouldExceedSize =
      currentChunk.totalSize + file.compressedSize > maxRequestSize;

    // Start new chunk if either:
    // 1. Gap to next file is too large
    // 2. Adding this file would make chunk too big
    if (gapToNext > maxGapSize || wouldExceedSize) {
      chunks.push({ ...currentChunk });
      currentChunk = {
        files: [file],
        startOffset: file.localHeaderOffset,
        endOffset: file.localHeaderOffset + file.compressedSize + 1000,
        totalSize: file.compressedSize + 1000,
      };
    } else {
      // Add to current chunk
      currentChunk.files.push(file);
      currentChunk.endOffset =
        file.localHeaderOffset + file.compressedSize + 1000;
      currentChunk.totalSize += file.compressedSize + 1000;
    }
  }

  // Add final chunk
  if (currentChunk.files.length > 0) {
    chunks.push(currentChunk);
  }

  // If we have too many chunks, merge some of the smaller ones
  while (chunks.length > maxConcurrentRequests) {
    // Find smallest gap between chunks
    let minGapIdx = 0;
    let minGap = Infinity;

    for (let i = 0; i < chunks.length - 1; i++) {
      const gap = chunks[i + 1].startOffset - chunks[i].endOffset;
      if (gap < minGap) {
        minGap = gap;
        minGapIdx = i;
      }
    }

    // Merge chunks at minGapIdx and minGapIdx + 1
    const merged = {
      files: [...chunks[minGapIdx].files, ...chunks[minGapIdx + 1].files],
      startOffset: chunks[minGapIdx].startOffset,
      endOffset: chunks[minGapIdx + 1].endOffset,
      totalSize:
        chunks[minGapIdx].totalSize + chunks[minGapIdx + 1].totalSize + minGap,
    };

    chunks.splice(minGapIdx, 2, merged);
  }

  // Calculate some stats
  const stats = {
    numberOfChunks: chunks.length,
    totalBytesToTransfer: chunks.reduce(
      (sum, chunk) => sum + (chunk.endOffset - chunk.startOffset),
      0,
    ),
    averageChunkSize:
      chunks.reduce(
        (sum, chunk) => sum + (chunk.endOffset - chunk.startOffset),
        0,
      ) / chunks.length,
    filesPerChunk: chunks.map((c) => c.files.length),
    wastedBytes: chunks.reduce((sum, chunk) => {
      const actualData = chunk.files.reduce((s, f) => s + f.compressedSize, 0);
      return sum + (chunk.endOffset - chunk.startOffset - actualData);
    }, 0),
  };

  return { chunks, stats };
}

async function fetchOptimizedChunks(url, files) {
  const { chunks, stats } = optimizeFileChunks(files, {
    maxRequestSize: 50 * 1024 * 1024, // 50MB max per request
    maxConcurrentRequests: 10, // Max 10 concurrent requests
    maxGapSize: 1 * 1024 * 1024, // 1MB max gap between files
  });

  console.log("Optimization stats:", stats);

  // Fetch all chunks in parallel (limited by maxConcurrentRequests)
  const chunkPromises = chunks.map(async (chunk) => {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${chunk.startOffset}-${chunk.endOffset}`,
      },
    });

    const buffer = await response.arrayBuffer();
    return {
      buffer,
      files: chunk.files,
      startOffset: chunk.startOffset,
    };
  });

  const results = await Promise.all(chunkPromises);

  // Process all files from their chunks
  const fileContents = new Map();

  for (const { buffer, files, startOffset } of results) {
    const view = new DataView(buffer);

    for (const file of files) {
      const relativeOffset = file.localHeaderOffset - startOffset;
      // ... (process individual file from chunk as before)
      // Add to fileContents map
    }
  }

  return fileContents;
}

// Example usage:
const files = [
  { localHeaderOffset: 1000, compressedSize: 500, fileName: "file1" },
  { localHeaderOffset: 1600, compressedSize: 300, fileName: "file2" },
  { localHeaderOffset: 50000, compressedSize: 1000, fileName: "file3" },
  // ... thousands more files
];

const { chunks, stats } = optimizeFileChunks(files);
console.log(`Optimized ${files.length} files into ${chunks.length} requests`);
console.log("Stats:", stats);
