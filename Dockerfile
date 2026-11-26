# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 node:24.22.3-bookworm-slim AS verified
RUN apt-get update && apt-get install --no-install-recommends -y unzip xz-utils && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4 https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/Godot_v4.7.2-stable_linux.x86_64.zip /tmp/godot.zip
ADD --checksum=sha256:a18ce0ccec3ecc40b0dd6c4f5132ca934e9fb7c2979717940ff32aee1eb35481 https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/godot-4.7.2-stable.tar.xz /tmp/godot-source.tar.xz
RUN unzip -j /tmp/godot.zip 'Godot_v4.7.2-stable_linux.x86_64' -d /opt && chmod 755 /opt/Godot_v4.7.2-stable_linux.x86_64 && /opt/Godot_v4.7.2-stable_linux.x86_64 --version | grep -Fx '4.7.2.stable.official.ed1daf0bf' \
 && mkdir /opt/godot-notices && tar -xJf /tmp/godot-source.tar.xz --strip-components=1 -C /opt/godot-notices godot-4.7.2-stable/LICENSE.txt godot-4.7.2-stable/COPYRIGHT.txt \
 && test -s /opt/godot-notices/LICENSE.txt && test -s /opt/godot-notices/COPYRIGHT.txt
WORKDIR /app
COPY service/ service/
COPY public-export/ public-export/
COPY vendor/ vendor/
COPY public-authority.pck prepare-release.sh start-release.sh RELEASE-FILES.sha256 ws-pins.sha256 ./
COPY Dockerfile .dockerignore THIRD_PARTY.md ./
ENV FOX_PUBLIC_GODOT_BIN=/opt/Godot_v4.7.2-stable_linux.x86_64
COPY engine/ engine/
RUN cat engine/godot-wasm.gz.* | gzip -dc > public-export/index.wasm \
 && ./prepare-release.sh
FROM --platform=linux/amd64 node:24.22.3-bookworm-slim
COPY --from=verified /opt/Godot_v4.7.2-stable_linux.x86_64 /opt/
COPY --from=verified /opt/godot-notices/ /usr/share/doc/fox-godot/
WORKDIR /app
COPY --from=verified /app/service/ service/
COPY --from=verified /app/public-export/ public-export/
COPY --from=verified /app/public-authority.pck /app/start-release.sh /app/THIRD_PARTY.md ./
ENV FOX_PUBLIC_GODOT_BIN=/opt/Godot_v4.7.2-stable_linux.x86_64
USER node
CMD ["./start-release.sh"]
