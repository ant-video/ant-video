'use strict';

importScripts('./chess.js');
self.onmessage = ({ data: { token, board, turn } }) => self.postMessage({ token, move: Chess.choose(board, turn) });
