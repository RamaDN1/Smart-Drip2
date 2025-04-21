import React, { useEffect, useState } from "react";

const RoomsList = () => {
    const [rooms, setRooms] = useState([]);

    useEffect(() => {
        fetch("http://localhost:3000/api/rooms") // تأكد أن هذا الـ API صحيح
            .then((response) => response.json())
            .then((data) => setRooms(data))
            .catch((error) => console.error("Error fetching rooms:", error));
    }, []);

    return (
        <div>
            <h2>Rooms List</h2>
            <ul>
                {rooms.map((room) => (
                    <li key={room.id}>
                        Room {room.room_number} - {room.occupied ? "Occupied" : "Available"} 
                        {room.patient_name && ` (Patient: ${room.patient_name})`}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default RoomsList;
