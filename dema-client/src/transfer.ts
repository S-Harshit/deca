// "Move files between my devices": a normal room that its creator marked as a personal one. The mark lives in this tab only
// (sessionStorage), so a refresh keeps it and nobody else is told. It only changes how the creator's page behaves: it shows the
// QR code at once and locks the room when the second device arrives.
const KEY = "deca.transfer";

export function markTransfer(roomId: string) {
  try {
    sessionStorage.setItem(KEY, roomId);
  } catch {
    // not remembered: the room still works, it just will not lock itself after a refresh
  }
}

export function isTransfer(roomId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === roomId;
  } catch {
    return false;
  }
}
