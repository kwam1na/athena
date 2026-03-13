interface ServerData {
  userId?: string;
  guestId?: string;
  actorToken?: string;
}

interface Window {
  serverData: ServerData;
}
