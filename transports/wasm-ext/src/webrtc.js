// Copyright 2020 Parity Technologies (UK) Ltd.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.


function httpSend(opts) {
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(opts.method, opts.url);
        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            }
            if (xhr.status == 200) {
                resolve(xhr.response);
            } else {
                reject({
                    status: xhr.status,
                    statusText: xhr.statusText,
                    body: xhr.response,
                });
            }
        };
        xhr.onerror = function () {
            reject({
                status: xhr.status,
                statusText: xhr.statusText
            });
        };
        if (opts.headers) {
            Object.keys(opts.headers).forEach(function (key) {
                xhr.setRequestHeader(key, opts.headers[key]);
            });
        }
        var params = opts.params;
        // We'll need to stringify if we've been given an object
        // If we have a string, this is skipped.
        if (params && typeof params === 'object') {
            params = Object.keys(params).map(function (key) {
                return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
            }).join('&');
        }
        xhr.send(params);
    });
}

export const webrtc_transport = async (crypto) => {
    const cert = await RTCPeerConnection.generateCertificate({
        name: "ECDSA",
        namedCurve: "P-256",
    });
    return {
        crypto,
        conn_config: {
            certificates: [cert],
            iceServers: [],
        },
        dial(addr) { return dial(this, addr); },
        listen_on(addr) {
            let err = new Error("Listening on WebRTC is not possible from within a browser");
            err.name = "NotSupportedError";
            throw err;
        },
    };
}

function signalAsSignInput(signal) {
    return new TextEncoder().encode(`${signal.type}${signal.sdp}${signal.identity_pub_key}${signal.target_peer_id}`);
}

function signSignal(self, signal) {
    let signalConcat = signalAsSignInput(signal);
    return bs58btc.encode(self.crypto.sign(signalConcat));
}

/// Throws error if invalid.
function verifyRemoteSignal(self, signal, expected_peer_id) {
    if (signal.target_peer_id != self.crypto.peer_id_as_b58()) {
        throw "Identity handshake failed! Reason: `target_peer_id` in the WebRTC answer, doesn't match with the expected local peer id.";
    }
    let pub_key_as_protobuf = bs58btc.decode(signal.identity_pub_key);
    let data = signalAsSignInput(signal);
    let signature = bs58btc.decode(signal.signature);
    self.crypto.assert_signature(pub_key_as_protobuf, data, signature);
    let peer_id = self.crypto.pub_key_as_protobuf_to_peer_id_as_b58(pub_key_as_protobuf);
    if (peer_id != expected_peer_id) {
        throw "Identity handshake failed! Peer's ID doesn't match the expected one."
    }
}

// Attempt to dial a multiaddress.
const dial = async (self, addr) => {
    const addrParsed = addr.match(/^\/(ip4|ip6|dns4|dns6|dns)\/(.*?)\/tcp\/([0-9]+)\/http\/p2p-webrtc-direct\/p2p\/([a-zA-Z0-9]+)$/);
    console.log("Dial: ", addr)
    console.log("parsed: ", addrParsed)
    if (addrParsed == null) {
        let err = new Error("Address not supported: " + addr);
        err.name = "NotSupportedError";
        throw err;
    }
    const target_peer_id = addrParsed[4];
    const conn = new RTCPeerConnection(self.conn_config);
    const channel = conn.createDataChannel("data", {
      ordered: true,
    });

    let offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    offer = {
        type: offer.type,
        sdp: offer.sdp,
        identity_pub_key: bs58btc.encode(self.crypto.pub_key_as_protobuf()),
        target_peer_id,
    };
    offer.signature = signSignal(self, offer);

    console.log("sending offer:", offer);
    const offerBase58 = bs58btc.encode(new TextEncoder().encode(JSON.stringify(offer)));
    const respBody = await httpSend({
        method: "GET",
        url: "http://" + addrParsed[2] + ":" + addrParsed[3] + "/?signal=" + offerBase58,
    });
    const answer = JSON.parse(new TextDecoder().decode(bs58btc.decode(respBody)));
    console.log("received answer:", answer);
    let remote_pub_key_as_protobuf = bs58btc.decode(answer.identity_pub_key);
    try {
    verifyRemoteSignal(self, answer, target_peer_id);
    } catch (e) {
        console.log("verify answer error:", e);
    }

    try {
        await conn.setRemoteDescription(new RTCSessionDescription(answer));
    } catch(e) {
        console.log("setRemoteDescription error:", e);
    }
    console.log("setRemoteDescription done");

    return new Promise((open_resolve, open_reject) => {
        let reader = read_queue();
		channel.onerror = (ev) => {
            console.log(ev);
			// If `open_resolve` has been called earlier, calling `open_reject` seems to be
			// silently ignored. It is easier to unconditionally call `open_reject` rather than
			// check in which state the connection is, which would be error-prone.
			open_reject(ev);
			// Injecting an EOF is how we report to the reading side that the connection has been
			// closed. Injecting multiple EOFs is harmless.
			reader.inject_eof();
		};
		channel.onclose = (ev) => {
            console.log(ev);
			// Same remarks as above.
			open_reject(ev);
			reader.inject_eof();
		};

		// We inject all incoming messages into the queue unconditionally. The caller isn't
		// supposed to access this queue unless the connection is open.
        channel.onmessage = (ev) => {
            console.log("received:", ev.data, "\n--str:", new TextDecoder().decode(ev.data));
            reader.inject_array_buffer(ev.data);
        }

        channel.onopen = () => {
            console.log("DataChannel opened");
            open_resolve({
                read: (function*() { while(channel.readyState == "open") {
                    let next = reader.next();
                    console.log("read:", next);
                    yield next;
                } })(),
                write: (data) => {
                    if (channel.readyState == "open") {
                        // The passed in `data` is an `ArrayBufferView` [0]. If the
                        // underlying typed array is a `SharedArrayBuffer` (when
                        // using WASM threads, so multiple web workers sharing
                        // memory) the WebSocket's `send` method errors [1][2][3].
                        // This limitation will probably be lifted in the future,
                        // but for now we have to make a copy here ..
                        //
                        // [0]: https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView
                        // [1]: https://chromium.googlesource.com/chromium/src/+/1438f63f369fed3766fa5031e7a252c986c69be6%5E%21/
                        // [2]: https://bugreports.qt.io/browse/QTBUG-78078
                        // [3]: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/bindings/IDLExtendedAttributes.md#AllowShared_p
                        console.log("send:", data, "\n--str:", new TextDecoder().decode(data));
                        channel.send(data.slice(0));
                        return promise_when_send_finished(channel);
                    } else {
                        return Promise.reject("WebRTC DataChannel is " + channel.readyState);
                    }
                },
                            remote_pub_key: () => {
                                return remote_pub_key_as_protobuf;
                                // const cert = conn.sctp.transport.getRemoteCertificates()[0];
                                // if (!cert) {
                                //     return null;
                                // }
                                // return new Uint8Array(cert);
                            },
                shutdown: () => channel.close(),
                close: () => {}
            });
        }
	});
}

// Takes a WebSocket object and returns a Promise that resolves when bufferedAmount is low enough
// to allow more data to be sent.
const promise_when_send_finished = (channel) => {
	return new Promise((resolve, reject) => {
		function check() {
			if (channel.readyState != "open") {
				reject("WebRTC DataChannel is " + channel.readyState);
				return;
			}

			// We put an arbitrary threshold of 8 kiB of buffered data.
			if (channel.bufferedAmount < 8 * 1024) {
				resolve();
			} else {
				setTimeout(check, 100);
			}
		}

		check();
	})
}

// Creates a queue reading system.
const read_queue = () => {
	// State of the queue.
	let state = {
		// Array of promises resolving to `ArrayBuffer`s, that haven't been transmitted back with
		// `next` yet.
		queue: new Array(),
		// If `resolve` isn't null, it is a "resolve" function of a promise that has already been
		// returned by `next`. It should be called with some data.
		resolve: null,
	};

	return {
		// Inserts a new Blob in the queue.
		inject_array_buffer: (buffer) => {
			if (state.resolve != null) {
				state.resolve(buffer);
				state.resolve = null;
			} else {
				state.queue.push(Promise.resolve(buffer));
			}
		},

		// Inserts an EOF message in the queue.
		inject_eof: () => {
			if (state.resolve != null) {
				state.resolve(null);
				state.resolve = null;
			} else {
				state.queue.push(Promise.resolve(null));
			}
		},

		// Returns a Promise that yields the next entry as an ArrayBuffer.
		next: () => {
			if (state.queue.length != 0) {
				return state.queue.shift(0);
			} else {
				if (state.resolve !== null)
					throw "Internal error: already have a pending promise";
				return new Promise((resolve, reject) => {
					state.resolve = resolve;
				});
			}
		}
	};
};
