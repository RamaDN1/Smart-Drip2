import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:3000/api', // تأكد من صحة عنوان السيرفر لديك
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;
