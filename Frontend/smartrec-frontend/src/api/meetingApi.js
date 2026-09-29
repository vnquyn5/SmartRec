import axiosClient from './axiosClient';

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
    }
};
