package com.example.toiletadmin;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ToiletAdminApplication {

    public static void main(String[] args) {
        SpringApplication.run(ToiletAdminApplication.class, args);
    }

}
