package com.example.smartrec.service.impl;

import java.io.IOException;
import java.util.Map;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import com.example.smartrec.config.AiSttProperties;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.AiSttService;
import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class AiSttServiceImpl implements AiSttService {
    private final AiSttProperties properties;
    private final RestTemplate restTemplate;

    @Override 
    public String transcribe(MultipartFile audioFile){
        if(audioFile == null || audioFile.isEmpty()){
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_REQUEST",
                    "File WAV không được để trống");
        }
        String fileName = audioFile.getOriginalFilename();
        if(fileName == null || !fileName.toLowerCase().endsWith(".wav")){
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_FILE_TYPE",
                    "Chỉ hổ trợ file WAV");
        }
        try {
            // lay URL co so cua AI tu cau hinh
            String workerUrl = UriComponentsBuilder.fromHttpUrl(properties.getBaseUrl())
                                                   .path(properties.getTranscribePath())
                                                   .build()
                                                   .toUriString();

            // doc toan bo noi dung file thanh mang byte
            // ByteArrayResource cho phep gui du lieu file qua http
            ByteArrayResource audioResource =new ByteArrayResource(audioFile.getBytes()){
                // cung cap ten file cho phan multipart
                @Override 
                public String getFilename(){
                    return fileName;
                }
            };
            // tao header rieng cho file am thanh
            HttpHeaders filHeaders  = new HttpHeaders();
            filHeaders.setContentType(MediaType.parseMediaType("audio/wav"));// khai bao du lieu file la audio/wav
            // dong goi file va header  thanh 1 Http entity
            HttpEntity<ByteArrayResource> filePart = new HttpEntity<>(audioResource,filHeaders);
            // tao body co nhieu phan theo dinh dang multipart
            MultiValueMap<String,Object> body= new LinkedMultiValueMap<>();
            body.add("file",filePart);
            // gui ten model theo cau honh BE
            body.add("model_name",properties.getModelName());
            // gui phien ban module theo cau hinh
            body.add("model_version", properties.getModelVersion());

            // tao herder cho toan bo Hppt request
            HttpHeaders headers = new HttpHeaders();
            //Khai báo body của request là multipart/form-data
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);
            HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);// ghep body va header thang request hoan chinh lai 
            //Map.class: yêu cầu Spring chuyển JSON response thanh 1 map de doc cac truong trong kq
             ResponseEntity<Map> response = restTemplate.postForEntity(workerUrl, request, Map.class);
             if(!response.getStatusCode().is2xxSuccessful() || response.getBody() == null){
                 throw new BusinessException(
                    HttpStatus.BAD_GATEWAY,
                    "ERR_STT_INVALID_RESPONSE",
                    "AI Worker không trả về kết quả STT hợp lệ");
             }
             // Lấy giá trị của trường "text" từ JSON response
             Object text= response.getBody().get("text");
             // kiem tra xem text nay co thuc su la String khong neu hop le java gan gia tri vao bien transcript
             if(!(text instanceof String  transcript) || transcript.isBlank()){
                 throw new BusinessException(
                    HttpStatus.BAD_GATEWAY,
                    "ERR_STT_INVALID_RESPONSE",
                    "AI Worker không trả về trường text hợp lệ");
             }
             return transcript;


        } catch (IOException  e) {
            // xay ra loi khi doc noi dung file
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "ERR_FILE_READ_FAILED",
                    "Không thể đọc nội dung file WAV");
        }catch(RestClientException e){
            // xay ra loi giao tiep voi AI
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY,
                    "ERR_AI_WORKER_UNAVAILABLE",
                    "Không thể kết nối hoặc nhận kết quả từ AI Worker");
        }
    }

    
}
