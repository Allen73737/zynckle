package com.zynckle.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class ZynckleApplication {
    public static void main(String[] args) { SpringApplication.run(ZynckleApplication.class, args); }
}
