import React, { useEffect, useState } from "react";
import api from "./api";

function App() {
    const [patients, setPatients] = useState([]);

    useEffect(() => {
        api.get("/patients")
            .then((response) => {
                setPatients(response.data.data);
            })
            .catch((error) => {
                console.error("Error fetching patients:", error);
            });
    }, []);

    return (
        <div>
            <h1>قائمة المرضى</h1>
            <ul>
                {patients.map((patient) => (
                    <li key={patient.id}>
                        {patient.name} - الغرفة {patient.room_number}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default App;
