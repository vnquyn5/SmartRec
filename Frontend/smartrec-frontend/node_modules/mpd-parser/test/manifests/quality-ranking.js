export const parsedManifest = {
  allowCache: true,
  discontinuityStarts: [],
  segments: [],
  timelineStarts: [{
    start: 0,
    timeline: 0
  }],
  endList: true,
  mediaGroups: {
    'AUDIO': {},
    'VIDEO': {},
    'CLOSED-CAPTIONS': {},
    'SUBTITLES': {}
  },
  uri: '',
  duration: 30,
  playlists: [
    {
      attributes: {
        'NAME': 'low',
        'AUDIO': 'audio',
        'SUBTITLES': 'subs',
        'RESOLUTION': {
          width: 640,
          height: 360
        },
        'CODECS': 'avc1.4d401e',
        'BANDWIDTH': 500000,
        'PROGRAM-ID': 1,
        'SCORE': 1 / 2
      },
      uri: '',
      endList: true,
      timeline: 0,
      resolvedUri: 'http://example.com/video_low.mp4',
      targetDuration: 30,
      discontinuityStarts: [],
      timelineStarts: [{
        start: 0,
        timeline: 0
      }],
      segments: [],
      sidx: {
        uri: 'http://example.com/video_low.mp4',
        resolvedUri: 'http://example.com/video_low.mp4',
        byterange: {
          length: 201,
          offset: 1000
        },
        map: {
          uri: '',
          resolvedUri: 'http://example.com/video_low.mp4',
          byterange: {
            length: 1000,
            offset: 0
          }
        },
        duration: 30,
        timeline: 0,
        presentationTime: 0,
        number: 0
      },
      mediaSequence: 0,
      discontinuitySequence: 0
    },
    {
      attributes: {
        'NAME': 'medium',
        'AUDIO': 'audio',
        'SUBTITLES': 'subs',
        'RESOLUTION': {
          width: 1280,
          height: 720
        },
        'CODECS': 'avc1.4d401f',
        'BANDWIDTH': 1000000,
        'PROGRAM-ID': 1,
        'SCORE': 1 / 6
      },
      uri: '',
      endList: true,
      timeline: 0,
      resolvedUri: 'http://example.com/video_medium.mp4',
      targetDuration: 30,
      discontinuityStarts: [],
      timelineStarts: [{
        start: 0,
        timeline: 0
      }],
      segments: [],
      sidx: {
        uri: 'http://example.com/video_medium.mp4',
        resolvedUri: 'http://example.com/video_medium.mp4',
        byterange: {
          length: 201,
          offset: 1000
        },
        map: {
          uri: '',
          resolvedUri: 'http://example.com/video_medium.mp4',
          byterange: {
            length: 1000,
            offset: 0
          }
        },
        duration: 30,
        timeline: 0,
        presentationTime: 0,
        number: 0
      },
      mediaSequence: 0,
      discontinuitySequence: 0
    },
    {
      attributes: {
        'NAME': 'high',
        'AUDIO': 'audio',
        'SUBTITLES': 'subs',
        'RESOLUTION': {
          width: 1920,
          height: 1080
        },
        'CODECS': 'avc1.4d4028',
        'BANDWIDTH': 2000000,
        'PROGRAM-ID': 1,
        'SCORE': 1 / 11
      },
      uri: '',
      endList: true,
      timeline: 0,
      resolvedUri: 'http://example.com/video_high.mp4',
      targetDuration: 30,
      discontinuityStarts: [],
      timelineStarts: [{
        start: 0,
        timeline: 0
      }],
      segments: [],
      sidx: {
        uri: 'http://example.com/video_high.mp4',
        resolvedUri: 'http://example.com/video_high.mp4',
        byterange: {
          length: 201,
          offset: 1000
        },
        map: {
          uri: '',
          resolvedUri: 'http://example.com/video_high.mp4',
          byterange: {
            length: 1000,
            offset: 0
          }
        },
        duration: 30,
        timeline: 0,
        presentationTime: 0,
        number: 0
      },
      mediaSequence: 0,
      discontinuitySequence: 0
    }
  ]
};

