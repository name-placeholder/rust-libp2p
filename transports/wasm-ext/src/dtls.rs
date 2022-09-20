use libp2p_core::{Connection, InboundUpgrade, OutboundUpgrade, PeerId, UpgradeInfo};

#[derive(Debug, Clone)]
pub struct NonDTLSConnectionError;

impl std::fmt::Display for NonDTLSConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Tried to authenticate using `DTLSAuthenticated` for non DTLS transport connection!")
    }
}

impl std::error::Error for NonDTLSConnectionError {
}

#[derive(Clone)]
pub struct DTLSAuthenticated;


impl DTLSAuthenticated {
    pub fn new() -> Self {
        Self {}
    }
}

impl UpgradeInfo for DTLSAuthenticated {
    type Info = &'static str;
    // type InfoIter = std::iter::Once<Self::Info>;
    type InfoIter = std::iter::Empty<Self::Info>;

    fn protocol_info(&self) -> Self::InfoIter {
        std::iter::empty()
        // std::iter::once("/dtls")
    }
}

impl<C> InboundUpgrade<C> for DTLSAuthenticated
where
    C: Connection,
{
    type Output = (PeerId, C);
    type Error = NonDTLSConnectionError;
    type Future = std::future::Ready<Result<Self::Output, Self::Error>>;

    fn upgrade_inbound(self, socket: C, _: Self::Info) -> Self::Future {
        let peer_id_result = socket
            .remote_peer_id()
            .map(|id| (id, socket))
            .ok_or(NonDTLSConnectionError);
        std::future::ready(peer_id_result)
    }
}

impl<C> OutboundUpgrade<C> for DTLSAuthenticated
where
    C: Connection,
{
    type Output = (PeerId, C);
    type Error = NonDTLSConnectionError;
    type Future = std::future::Ready<Result<Self::Output, Self::Error>>;

    fn upgrade_outbound(self, socket: C, _: Self::Info) -> Self::Future {
        let peer_id_result = socket
            .remote_peer_id()
            .map(|id| (id, socket))
            .ok_or(NonDTLSConnectionError);
        std::future::ready(peer_id_result)
    }
}
