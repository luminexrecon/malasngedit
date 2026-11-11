(function (root) {
  'use strict';

  const listeners = new Set();

  const peer = root.Wire.createPeer({
    post: (message) => root.uxpHost.postMessage(message),
    onProgress: (progress) => listeners.forEach((listener) => listener(progress)),
  });

  root.addEventListener('message', (event) => peer.receive(event.data));

  root.Bridge = {
    call: peer.call,
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})(window);
