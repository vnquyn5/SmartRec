package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.OCRResult;
import com.example.smartrec.entity.SlideKeyframe;
import com.example.smartrec.model.dto.SlideOCRResponse;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.OCRResultRepository;
import com.example.smartrec.repository.SlideKeyframeRepository;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.SlideOCRService;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import lombok.RequiredArgsConstructor;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collector;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

@Service
@RequiredArgsConstructor
public class SlideOCRServiceImpl implements SlideOCRService {
    private final SlideKeyframeRepository slideKeyframeRepository;
    private final OCRResultRepository ocrResultRepository;
    private final MeetingRepository meetingRepository;
    private final MinioService minioService;
    @Value ("${minio.slide-bucket-name}")
    private String slideBucketName;

    @Override 
    @Transactional (readOnly=true)
    public List<SlideOCRResponse> getMeetingSlides(UUID meetingId){
        Meeting meeting =meetingRepository.findById(meetingId).orElseThrow(()-> new ResponseStatusException(HttpStatus.NOT_FOUND,"Không tìm thấy Meeting"));
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication(); // kiem tra nguoi dung da dang nhap
        // lay slide theo meeting sap xep timestamp tang dan
        List<SlideKeyframe> slides = slideKeyframeRepository.findByMeetingIdOrderByTimestampMsAsc(meetingId);
        return slides.stream().map(this::toReponse)
                              .collect(Collectors.toList());
    }
    private SlideOCRResponse toReponse(SlideKeyframe slide){
        // lay ocr theo keyframe ID
        List<OCRResult> ocrResults=ocrResultRepository.findByKeyframeId(slide.getId());
        String ocrText = ocrResults.stream()
                            .map(OCRResult::getExtractedText) // Chuyển mỗi OCRResult thành chuỗi văn bản đã nhận diện
                            .filter(text -> text !=null && !text.isBlank())// Bỏ qua văn bản null, chuỗi rỗng hoặc chỉ chứa khoảng trắng
                            .findFirst()// Chọn văn bản hợp lệ đầu tiên tìm được
                            .orElse(null);// Nếu không có văn bản hợp lệ thì gán ocrText bằng null

        String objectKey = slide.getImageObjectKey();
        String imageUrl = null;
        if(objectKey !=null && !objectKey.isBlank()){
            if(minioService.objectExists(slideBucketName,objectKey)){
                // Nếu ảnh tồn tại, tạo presigned URL để truy cập ảnh
                // URL có chữ ký và thời hạn sử dụng theo cấu hình MinIO
                imageUrl = minioService.presignGetObject(slideBucketName, objectKey);
            }
        }
         return new SlideOCRResponse(
            slide.getId(),
            slide.getTimestampMs(),
            imageUrl,
            ocrText
    );
    }
}
