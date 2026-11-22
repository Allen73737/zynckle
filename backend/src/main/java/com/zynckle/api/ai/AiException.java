package com.zynckle.api.ai;

import com.zynckle.api.common.ApiException;

/** An AI or provider failure; rendered as JSON by {@link com.zynckle.api.common.ApiErrors}. */
public class AiException extends ApiException {
    public AiException(int status, String message) { super(status, message); }
}
