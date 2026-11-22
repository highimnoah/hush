use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use hush_session_protocol::{
    ClientMessage, Member, ServerMessage, SessionState, CODE_LEN, MAX_MEMBERS, PROTOCOL_VERSION,
};
use rand::Rng;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

type Registry = Arc<Mutex<HashMap<String, Room>>>;

struct MemberEntry {
    name: String,
    tx: mpsc::UnboundedSender<ServerMessage>,
}

struct Room {
    host_id: String,
    order: Vec<String>,
    members: HashMap<String, MemberEntry>,
    last_state: Option<SessionState>,
}

impl Room {
    fn member_list(&self) -> Vec<Member> {
        self.order
            .iter()
            .filter_map(|id| {
                self.members.get(id).map(|member| Member {
                    id: id.clone(),
                    name: member.name.clone(),
                    is_host: *id == self.host_id,
                })
            })
            .collect()
    }

    fn broadcast(&self, except: Option<&str>, message: &ServerMessage) {
        for (id, member) in &self.members {
            if Some(id.as_str()) == except {
                continue;
            }
            let _ = member.tx.send(message.clone());
        }
    }

    fn send_to(&self, id: &str, message: &ServerMessage) {
        if let Some(member) = self.members.get(id) {
            let _ = member.tx.send(message.clone());
        }
    }
}

fn generate_code(rooms: &HashMap<String, Room>) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    loop {
        let code: String = (0..CODE_LEN)
            .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
            .collect();
        if !rooms.contains_key(&code) {
            return code;
        }
    }
}

#[tokio::main]
async fn main() {
    let bind = std::env::var("HUSH_SYNC_BIND").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
    let listener = match TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("[hush-sync] could not bind {bind}: {err}");
            std::process::exit(1);
        }
    };

    eprintln!("[hush-sync] listening on {bind}");
    let registry: Registry = Arc::new(Mutex::new(HashMap::new()));

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let registry = registry.clone();
                tokio::spawn(async move {
                    handle_connection(stream, registry).await;
                });
            }
            Err(err) => {
                eprintln!("[hush-sync] accept error: {err}");
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        }
    }
}

async fn handle_connection(stream: TcpStream, registry: Registry) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(err) => {
            eprintln!("[hush-sync] handshake failed: {err}");
            return;
        }
    };

    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let text = match serde_json::to_string(&message) {
                Ok(text) => text,
                Err(_) => continue,
            };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let id = format!("{:016x}", rand::random::<u64>());
    let _ = tx.send(ServerMessage::Welcome { id: id.clone() });

    let mut name = "Listener".to_string();
    let mut joined: Option<String> = None;

    while let Some(frame) = source.next().await {
        let frame = match frame {
            Ok(frame) => frame,
            Err(err) => {
                eprintln!("[hush-sync] read error: {err}");
                break;
            }
        };

        let text = match frame {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };

        let message: ClientMessage = match serde_json::from_str(&text) {
            Ok(message) => message,
            Err(_) => {
                let _ = tx.send(ServerMessage::Error {
                    message: "invalid message".into(),
                });
                continue;
            }
        };

        match message {
            ClientMessage::Hello {
                name: requested,
                protocol,
            } => {
                if protocol != PROTOCOL_VERSION {
                    let _ = tx.send(ServerMessage::Error {
                        message: format!(
                            "protocol mismatch (relay {PROTOCOL_VERSION}, client {protocol})"
                        ),
                    });
                    break;
                }
                let trimmed: String = requested.trim().chars().take(40).collect();
                if !trimmed.is_empty() {
                    name = trimmed;
                }
            }
            ClientMessage::Create => {
                if joined.is_some() {
                    let _ = tx.send(ServerMessage::Error {
                        message: "already in a session".into(),
                    });
                    continue;
                }

                let mut rooms = registry.lock().await;
                let code = generate_code(&*rooms);
                let mut room = Room {
                    host_id: id.clone(),
                    order: vec![id.clone()],
                    members: HashMap::new(),
                    last_state: None,
                };
                room.members.insert(
                    id.clone(),
                    MemberEntry {
                        name: name.clone(),
                        tx: tx.clone(),
                    },
                );
                let members = room.member_list();
                rooms.insert(code.clone(), room);
                drop(rooms);

                joined = Some(code.clone());
                let _ = tx.send(ServerMessage::Created { code: code.clone() });
                let _ = tx.send(ServerMessage::Joined {
                    code: code.clone(),
                    host_id: id.clone(),
                    members,
                });
                eprintln!("[hush-sync] room {code} created by {name}");
            }
            ClientMessage::Join { code } => {
                if joined.is_some() {
                    let _ = tx.send(ServerMessage::Error {
                        message: "already in a session".into(),
                    });
                    continue;
                }

                let mut rooms = registry.lock().await;
                let Some(room) = rooms.get_mut(&code) else {
                    let _ = tx.send(ServerMessage::Error {
                        message: "session not found".into(),
                    });
                    continue;
                };
                if room.members.len() >= MAX_MEMBERS {
                    let _ = tx.send(ServerMessage::Error {
                        message: "session is full".into(),
                    });
                    continue;
                }

                room.order.push(id.clone());
                room.members.insert(
                    id.clone(),
                    MemberEntry {
                        name: name.clone(),
                        tx: tx.clone(),
                    },
                );
                let members = room.member_list();
                let host_id = room.host_id.clone();
                let last_state = room.last_state.clone();
                room.broadcast(
                    Some(&id),
                    &ServerMessage::MemberJoined {
                        member: Member {
                            id: id.clone(),
                            name: name.clone(),
                            is_host: false,
                        },
                    },
                );
                drop(rooms);

                joined = Some(code.clone());
                let _ = tx.send(ServerMessage::Joined {
                    code: code.clone(),
                    host_id,
                    members,
                });
                if let Some(state) = last_state {
                    let _ = tx.send(ServerMessage::State { state });
                }
                eprintln!("[hush-sync] {name} joined room {code}");
            }
            ClientMessage::State { state } => {
                let mut rooms = registry.lock().await;
                let Some(code) = joined.as_ref() else {
                    continue;
                };
                let Some(room) = rooms.get_mut(code) else {
                    continue;
                };
                if room.host_id != id {
                    let _ = tx.send(ServerMessage::Error {
                        message: "only the host can update playback".into(),
                    });
                    continue;
                }
                room.last_state = Some(state.clone());
                room.broadcast(Some(&id), &ServerMessage::State { state });
            }
            ClientMessage::SyncReq { nonce, t0 } => {
                let rooms = registry.lock().await;
                let Some(code) = joined.as_ref() else {
                    continue;
                };
                let Some(room) = rooms.get(code) else {
                    continue;
                };
                if room.host_id == id {
                    continue;
                }
                let host_id = room.host_id.clone();
                room.send_to(
                    &host_id,
                    &ServerMessage::SyncReq {
                        from: id.clone(),
                        nonce,
                        t0,
                    },
                );
            }
            ClientMessage::SyncResp {
                to,
                nonce,
                t1,
                t2,
            } => {
                let rooms = registry.lock().await;
                let Some(code) = joined.as_ref() else {
                    continue;
                };
                let Some(room) = rooms.get(code) else {
                    continue;
                };
                if room.host_id != id {
                    continue;
                }
                room.send_to(&to, &ServerMessage::SyncResp { nonce, t1, t2 });
            }
            ClientMessage::Leave => break,
            ClientMessage::Heartbeat => {}
        }
    }

    if let Some(code) = joined {
        let mut rooms = registry.lock().await;
        let mut remove_room = false;

        if let Some(room) = rooms.get_mut(&code) {
            room.members.remove(&id);
            room.order.retain(|member| member != &id);

            if room.members.is_empty() {
                remove_room = true;
            } else {
                room.broadcast(None, &ServerMessage::MemberLeft { id: id.clone() });
                if room.host_id == id {
                    if let Some(next) = room.order.first().cloned() {
                        room.host_id = next.clone();
                        room.broadcast(None, &ServerMessage::HostChanged { host_id: next.clone() });
                        eprintln!("[hush-sync] room {code}: host migrated to {next}");
                    }
                }
            }
        }

        if remove_room {
            rooms.remove(&code);
            eprintln!("[hush-sync] room {code} closed");
        }
    }

    drop(tx);
    let _ = writer.await;
}
