package com.zynckle.api.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/** Every API error is JSON shaped as {"error": "..."}, which is what the frontend reads. */
@RestControllerAdvice
public class ApiErrors {
    private final ErrorReporter reporter;

    public ApiErrors(ErrorReporter reporter) { this.reporter = reporter; }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException e) {
        return ResponseEntity.status(e.status()).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "The request body is not valid JSON"));
    }

    @ExceptionHandler(ClassCastException.class)
    ResponseEntity<Map<String, Object>> badType(ClassCastException e) {
        return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "A field in the request has the wrong type"));
    }

    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    ResponseEntity<Map<String, Object>> data(org.springframework.dao.DataAccessException e, jakarta.servlet.http.HttpServletRequest request) {
        reporter.server(request.getMethod() + " " + request.getRequestURI(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Something went wrong on the server"));
    }

    /** Framework errors keep their status (404, 405, 415…); anything else is an unexpected 500 and is reported. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception e, jakarta.servlet.http.HttpServletRequest request) {
        if (e instanceof org.springframework.web.ErrorResponse er) {
            int status = er.getStatusCode().value();
            if (status >= 500) reporter.server(request.getMethod() + " " + request.getRequestURI(), e);
            return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", status == 404 ? "Not found" : status == 405 ? "Method not allowed" : "Request failed"));
        }
        if (e instanceof org.springframework.web.context.request.async.AsyncRequestNotUsableException) return null; // client went away mid-stream
        reporter.server(request.getMethod() + " " + request.getRequestURI(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Something went wrong on the server"));
    }
}
