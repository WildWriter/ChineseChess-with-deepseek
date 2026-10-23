import { parentPort, workerData } from 'node:worker_threads';
import { searchImportedMate } from './position-search.js';
parentPort.postMessage(searchImportedMate(workerData.fen, workerData.maxMoves));
