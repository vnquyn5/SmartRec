package com.example.smartrec.service.impl;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import org.springframework.data.convert.ReadingConverter;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.method.P;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.FfprobeService;

import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor  
public class FfprobeServiceImpl implements FfprobeService{
    private final String ffprobeCommand = "ffprobe";

    @Override 
    public double getDuration(String filePath){
        try {
            // tao yeu cau ffprobe
            ProcessBuilder processBuilder=new ProcessBuilder(ffprobeCommand,
                                                            "-v","error", // chi hien thi err khong hien thi log can thiet
                                                            "-show_entries", "format=duration", // yeu cau ffprobe lay duration cua file
                                                            "-of", "default=noprint_wrappers=1:nokey=1",// quy dinh format output, chi lay duration khong lay ten field
                                                            filePath // duong dan file can kiem tra
            );

            // gop error output vao output chinh
            processBuilder.redirectErrorStream(true);
            // chay ffprobe
            Process process = processBuilder.start();
            StringBuilder output = new StringBuilder();

            // doc text theo tung dong                      // chuyen byte thanh text    // lay du lieu ffprobe tra ve
            try(BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(),StandardCharsets.UTF_8))){
                String line;
                // doc tung dong cho den het output
                while((line = reader.readLine())!=null){
                    output.append(line);
                }
            }
            // cho ff chay xong
            int exitCode = process.waitFor();
            String result=output.toString().trim();

            // neu ff chay that bai
            if(exitCode !=0){
                throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Không thể đọc metadata của media");
            }
            // khong lay dc duration
            if(result.isBlank()){
                throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Không thể đọc duration của media");
            }
            double duration;
            try {
                duration = Double.parseDouble(result);
            } catch (NumberFormatException  e) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Duration của media không hợp lệ");
            }
            if(duration<0){
                throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Duration của media không hợp lệ");
            }
            return  duration;
        } catch (BusinessException e) {
            throw e;
        }catch(Exception e){
            // ff khong ton tai 
            // file khong ton tai
            // process khong chay duoc
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_MEDIA_METADATA_READ_FAILED", "Không thể đọc duration của media");
        }
    }
    
}
