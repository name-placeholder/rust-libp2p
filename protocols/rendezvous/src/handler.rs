// Copyright 2021 COMIT Network.
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

use crate::codec;
use crate::codec::Message;
use libp2p_swarm::StreamProtocol;
use void::Void;

const PROTOCOL_IDENT: StreamProtocol = StreamProtocol::new("/rendezvous/1.0.0");

pub(crate) mod inbound;
pub(crate) mod outbound;
/// Errors that can occur while interacting with a substream.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Reading message {0:?} at this stage is a protocol violation")]
    BadMessage(Message),
    #[error("Failed to write message to substream")]
    WriteMessage(#[source] codec::Error),
    #[error("Failed to read message from substream")]
    ReadMessage(#[source] codec::Error),
    #[error("Substream ended unexpectedly mid-protocol")]
    UnexpectedEndOfStream,
}

pub(crate) type OutboundInEvent = crate::substream_handler::InEvent<outbound::OpenInfo, Void, Void>;
pub(crate) type OutboundOutEvent =
    crate::substream_handler::OutEvent<Void, outbound::OutEvent, Void, Error>;

pub(crate) type InboundInEvent = crate::substream_handler::InEvent<(), inbound::InEvent, Void>;
pub(crate) type InboundOutEvent =
    crate::substream_handler::OutEvent<inbound::OutEvent, Void, Error, Void>;
