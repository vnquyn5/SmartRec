import axiosClient from './axiosClient';
import mockApiContracts from '../mocks/Mock_API_Contracts.json';

export const meetingApi = {
    getProcessedMeetings: (params) => {
        return axiosClient.get('/meetings', {
            params: {
                status: 'PROCESSED',
                ...params,
            }
        });
    },
    deleteMeeting: (id) => {
        return axiosClient.delete(`/meetings/${id}`);
    
},

getMeetingAiResults: async (meetingId) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                status: "success",
                data: mockApiContracts
            });
        }, 1000);
    });
    }
};

export default meetingApi; 
