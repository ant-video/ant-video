'use strict';

importScripts('./engine.js');

self.onmessage = ({ data }) => {
  const { moves, difficulty, token } = data;
  self.postMessage({ token, cell: Gomoku.chooseMove(moves, difficulty) });
};
