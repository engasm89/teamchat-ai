/** Only send into a room obtained from the authenticated /api/rooms list.
 * Connection state alone is not proof that a room is available to this user. */
export function canSendInRoom(allowedRooms:readonly string[],room:string,status:string):boolean{
 return status==="online"&&room.length>0&&allowedRooms.includes(room);
}
